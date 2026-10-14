import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MailAddress, OutboundAttachmentInput, User } from '$lib/types';
import { appendEmailSignature } from '$lib/email-signature';
import { insertAttachments } from './attachments';
import { validateAttachmentInputs } from '$lib/utils/attachment-input';
import {
	getAddressForUser,
	getDefaultAddress,
	getDomainByName,
	listAddressesForUser
} from './domains';
import { getDomainPermissionFlags } from './domain-permissions';
import { parseEmailAddress } from './email-address';
import { resolveOutboundSignature } from './email-signature';
import { stripHtml } from './html';
import { insertEmail } from './mail-store';
import { initialOutboundStatus, type EmailProvider } from './email-provider';
import { escapeHtml, parseRecipients, sendOutboundEmail } from './send-mail';

export type ComposeInput = {
	fromAddressId?: string | null;
	/** Pre-resolved identity — used by replies so we can send from the received mailbox. */
	fromAddress?: MailAddress | null;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	text?: string | null;
	html?: string | null;
	inReplyTo?: string | null;
	references?: string | null;
	replyToEmailId?: string | null;
	attachments?: OutboundAttachmentInput[];
	/** Public origin for hosted signature images. */
	origin?: string;
	/** Defaults to true for new mail and false for replies. */
	includeSignature?: boolean;
	/** Explicit library pick. `null` omits a signature; omit the field to use the default. */
	signatureId?: string | null;
};

/**
 * Pick the identity a message is sent from: the one the composer chose, or the
 * user's default. Only addresses the user actually owns are accepted.
 */
export async function resolveFromAddress(
	db: D1Database,
	user: User,
	addressId?: string | null
): Promise<MailAddress> {
	const address = addressId
		? await getAddressForUser(db, user.id, addressId)
		: await getDefaultAddress(db, user.id);

	if (!address) {
		throw new Error('No sending address configured. Add one in Settings first.');
	}

	const permission = await getDomainPermissionFlags(db, user, address.domain_id);
	if (!permission.can_send) {
		throw new Error(`You cannot send mail from ${address.domain_name}`);
	}

	return address;
}

/**
 * Replies come from the mailbox that received the original, not the default
 * sending identity. Catch-all mail uses that exact recipient if the user owns
 * the domain, even when the local-part is not a saved address.
 *
 * Returns null when the user has no sending identity, so the thread page can
 * still load.
 */
export async function resolveReplyFromAddress(
	db: D1Database,
	user: User,
	original: { direction: 'inbound' | 'outbound'; to_addr: string; from_addr: string }
): Promise<MailAddress | null> {
	const mailbox = parseEmailAddress(
		original.direction === 'inbound' ? original.to_addr : original.from_addr
	);

	const owned = await listAddressesForUser(db, user.id);
	const exact = owned.find((address) => address.address.toLowerCase() === mailbox);
	if (exact && (await getDomainPermissionFlags(db, user, exact.domain_id)).can_send) {
		return exact;
	}

	const domainName = mailbox.split('@')[1];
	const domain = domainName ? await getDomainByName(db, domainName) : null;
	const canSendOnDomain =
		domain &&
		(domain.catchall_user_id === user.id ||
			owned.some((address) => address.domain_id === domain.id));

	if (
		domain &&
		canSendOnDomain &&
		mailbox.includes('@') &&
		(await getDomainPermissionFlags(db, user, domain.id)).can_send
	) {
		return {
			id: `reply:${mailbox}`,
			user_id: user.id,
			domain_id: domain.id,
			domain_name: domain.name,
			address: mailbox,
			label: null,
			signature: null,
			signature_id: null,
			is_default: false,
			created_at: new Date().toISOString()
		};
	}

	for (const address of owned) {
		if (address.is_default && (await getDomainPermissionFlags(db, user, address.domain_id)).can_send) {
			return address;
		}
	}

	for (const address of owned) {
		if ((await getDomainPermissionFlags(db, user, address.domain_id)).can_send) {
			return address;
		}
	}

	return null;
}

export type SendResult = {
	/** null when the provider accepted the mail but it could not be recorded in Sent. */
	emailId: string | null;
	providerId: string;
	from: MailAddress;
	/** Problems after delivery. The mail WAS sent; do not offer a retry. */
	warnings: string[];
};

const RECORD_ATTEMPTS = 3;

/** Once the provider accepted a message, record it with a few retries and without duplicating. */
async function recordWithRetry(
	db: D1Database,
	providerId: string,
	record: () => Promise<string>,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<string> {
	let lastError: unknown;
	for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt++) {
		try {
			return await record();
		} catch (error) {
			lastError = error;
			// A write whose acknowledgement was lost may have landed: never insert twice.
			try {
				const existing = await db.prepare('SELECT id FROM emails WHERE provider_id = ? LIMIT 1').bind(providerId).first<{ id: string }>();
				if (existing) return existing.id;
			} catch { /* database still unavailable; retry */ }
			if (attempt < RECORD_ATTEMPTS - 1) await sleep(100 * 3 ** attempt);
		}
	}
	throw lastError;
}

/**
 * Send through the configured provider, then record it in the Sent folder.
 * Failures before the provider accepts the mail throw. Failures after it are
 * reported as warnings instead: the message is already delivered, and
 * surfacing an error would invite the user to send it a second time.
 */
export async function sendAndStore(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	provider: EmailProvider,
	user: User,
	input: ComposeInput
): Promise<SendResult> {
	// resolveFromAddress scopes the lookup to this user, so ownership is implied.
	const from = input.fromAddress ?? (await resolveFromAddress(env.DB, user, input.fromAddressId));
	const permission = await getDomainPermissionFlags(env.DB, user, from.domain_id);
	if (!permission.can_send) {
		throw new Error(`You cannot send mail from ${from.domain_name}`);
	}

	const bodyHtml = input.html?.trim() || null;
	const bodyText = input.text?.trim() || (bodyHtml ? stripHtml(bodyHtml) : '');

	// The automatic signature does not count as message content.
	if (!bodyText && !bodyHtml && !input.attachments?.length) {
		throw new Error('Message body is required');
	}

	const includeSignature = input.includeSignature ?? !input.replyToEmailId;
	const signature =
		input.signatureId !== undefined || includeSignature
			? await resolveOutboundSignature(env.DB, user.id, from, {
					signatureId: input.signatureId,
					includeSignature,
					isReply: Boolean(input.replyToEmailId)
				})
			: '';
	const { text, html } = signature
		? appendEmailSignature({
				text: bodyText,
				html: bodyHtml,
				signature,
				origin: input.origin ?? ''
			})
		: { text: bodyText, html: bodyHtml };

	const attachments = input.attachments ?? [];
	validateAttachmentInputs(attachments);

	const { providerId } = await sendOutboundEmail(provider, {
		from,
		senderName: from.label?.trim() || user.name,
		to: input.to,
		cc: input.cc ?? undefined,
		bcc: input.bcc ?? undefined,
		subject: input.subject,
		text,
		html: html ?? undefined,
		inReplyTo: input.inReplyTo,
		references: input.references,
		attachments
	});

	const warnings: string[] = [];
	let emailId: string | null = null;
	try {
		emailId = await recordWithRetry(env.DB, providerId, () =>
			insertEmail(env.DB, {
				userId: user.id,
				direction: 'outbound',
				from: from.address,
				to: parseRecipients(input.to).join(', '),
				cc: parseRecipients(input.cc).join(', ') || null,
				bcc: parseRecipients(input.bcc).join(', ') || null,
				subject: input.subject.trim(),
				bodyText: text,
				bodyHtml: html ?? escapeHtml(text).replaceAll('\n', '<br>\n'),
				inReplyTo: input.inReplyTo ?? null,
				references: input.references ?? null,
				replyToEmailId: input.replyToEmailId ?? null,
				domainId: from.domain_id,
				providerId,
				status: initialOutboundStatus(provider.kind),
				isRead: true
			})
		);
	} catch (error) {
		console.error('Message was sent but could not be saved to Sent', providerId, error);
		warnings.push('Your message was sent, but it could not be saved to your Sent folder.');
	}

	if (emailId && attachments.length > 0) {
		try {
			await insertAttachments(env.DB, env.ATTACHMENTS, emailId, attachments);
		} catch (error) {
			console.error('Message was sent but its attachments could not be saved', providerId, error);
			warnings.push('Your message was sent, but its attachments could not be saved to your Sent folder.');
		}
	}

	return { emailId, providerId, from, warnings };
}

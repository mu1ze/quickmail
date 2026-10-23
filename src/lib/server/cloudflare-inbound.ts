import { readBoundedBody } from './request-limits';
import { inboundAnalysisMetadata } from './subq';
import { dispatchAnalysis, type AnalysisEnv } from './mail-analysis-jobs';
import type { R2Bucket } from '@cloudflare/workers-types';
import PostalMime, { type Address, type Attachment, type Email } from 'postal-mime';
import { insertAttachmentBytes } from './attachments';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from './constants';
import { recordUnroutedEmail, resolveInboundRoute } from './domains';
import { collectInboundRecipients, parseEmailAddress, senderDisplayName, visibleInboundFrom } from './email-address';
import { emailExistsByProviderId, insertEmail } from './mail-store';
import { scheduleNewMailNotification, type PushNotificationEnv } from './push-notifications';
import { normalizeMessageId } from './send-mail';

export type CloudflareInboundMessage = {
	/** SMTP envelope MAIL FROM (Return-Path), not the RFC 5322 From header. */
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream<Uint8Array>;
	setReject(reason: string): void;
};

export type CloudflareInboundEnv = PushNotificationEnv & AnalysisEnv & {
	ATTACHMENTS: R2Bucket;
};

/**
 * Email Routing delivers the full MIME on `message.raw`. Parse once, then reuse
 * the same mailbox routing and D1/R2 store as the Resend webhook path.
 */
export async function handleCloudflareInbound(
	message: CloudflareInboundMessage,
	env: CloudflareInboundEnv
): Promise<void> {
	let raw: ArrayBuffer;
	try { const bytes=await readBoundedBody(message.raw, 15*1024*1024); raw=bytes.buffer as ArrayBuffer; }
	catch { message.setReject('Message exceeds the 15 MiB limit'); return; }
	const parsed = await parseInbound(raw, message.headers);

	const envelopeTo = parseEmailAddress(message.to);
	const recipients = collectInboundRecipients({
		received_for: envelopeTo.includes('@') ? [envelopeTo] : [],
		to: mailboxAddresses(parsed.to),
		cc: mailboxAddresses(parsed.cc),
		bcc: mailboxAddresses(parsed.bcc)
	});

	const from = visibleInboundFrom(
		message.from,
		mailboxAddresses(parsed.from)[0] ?? message.headers.get('from')
	);
	const subject = parsed.subject?.trim() || message.headers.get('subject')?.trim() || '(no subject)';
	const messageId =
		normalizeMessageId(parsed.messageId ?? message.headers.get('message-id')) ?? null;
	const inReplyTo =
		normalizeMessageId(parsed.inReplyTo ?? message.headers.get('in-reply-to')) ?? null;
	const references = parsed.references ?? message.headers.get('references') ?? null;
	const providerId = await inboundProviderId({
		messageId,
		from,
		to: envelopeTo || recipients.join(','),
		date: parsed.date ?? message.headers.get('date'),
		raw
	});

	if (await emailExistsByProviderId(env.DB, providerId)) {
		return;
	}

	const route = await resolveInboundRoute(env.DB, recipients);

	if (!route) {
		await recordUnroutedEmail(env.DB, {
			providerId,
			from,
			to: recipients.join(', ') || envelopeTo || '(unknown)',
			subject,
			reason: 'No matching address and no catch-all for this domain'
		});
		return;
	}

	const emailId = await insertEmail(env.DB, {
		deduplicationId: `inbound-${providerId}`,
		userId: route.userId,
		direction: 'inbound',
		from,
		fromName: parsed.from?.address?.toLowerCase() === from && parsed.from.name?.trim()
			? parsed.from.name.trim() : senderDisplayName(message.headers.get('from'), from),
		to: route.address,
		cc: mailboxAddresses(parsed.cc).join(', ') || null,
		subject,
		bodyText: parsed.text ?? null,
		bodyHtml: parsed.html ?? null,
		messageId,
		inReplyTo,
		references,
		domainId: route.domainId,
		providerId,
		analysisMetadata: inboundAnalysisMetadata(message.headers, 'cloudflare', { envelopeFrom: message.from, visibleTo: mailboxAddresses(parsed.to), visibleCc: mailboxAddresses(parsed.cc), attachments: parsed.attachments.slice(0, 20).map(a => ({ filename: a.filename || 'attachment', type: a.mimeType })) })
	});

	await storeInboundAttachments(env, emailId, parsed.attachments);
	const analysis = dispatchAnalysis(env, route.userId, emailId).catch(() => undefined);
	if (env.waitUntil) env.waitUntil(analysis); else await analysis;
	await scheduleNewMailNotification(env, {
		emailId,
		userId: route.userId,
		from,
		subject
	});
}

const FALLBACK_TEXT_CHARS = 20_000;

/**
 * Never lose a message to a parser limit or malformed MIME. When parsing fails,
 * keep what the transport already told us (envelope, headers) and the raw body
 * text, flagged so the reader knows it is unformatted.
 */
async function parseInbound(raw: ArrayBuffer, headers: Headers): Promise<Email> {
	try {
		return await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
	} catch (error) {
		console.error('Inbound MIME could not be parsed; storing a plain-text fallback', error instanceof Error ? error.message : error);
		const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
		const separator = /\r?\n\r?\n/.exec(text);
		const body = separator ? text.slice(separator.index + separator[0].length) : '';
		return {
			headers: [],
			attachments: [],
			subject: headers.get('subject') ?? undefined,
			text: `[This message could not be fully parsed, so its raw content is shown.]\n\n${body.slice(0, FALLBACK_TEXT_CHARS)}`
		} as unknown as Email;
	}
}

async function storeInboundAttachments(
	env: CloudflareInboundEnv,
	emailId: string,
	attachments: Attachment[]
): Promise<void> {
	for (const attachment of attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
		const bytes = attachmentBytes(attachment.content);
		if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
			continue;
		}

		try {
			await insertAttachmentBytes(env.DB, env.ATTACHMENTS, emailId, {
				filename: attachment.filename || 'attachment',
				type: attachment.mimeType || 'application/octet-stream',
				contentId: attachment.contentId,
				disposition: attachment.disposition,
				bytes
			});
		} catch (error) {
			console.error('Failed to store inbound Cloudflare attachment', attachment.filename, error);
		}
	}
}

function mailboxAddresses(value: Address | Address[] | undefined): string[] {
	if (!value) return [];
	const list = Array.isArray(value) ? value : [value];
	const addresses: string[] = [];

	for (const item of list) {
		if (item.address) addresses.push(item.address);
		if (item.group) {
			for (const member of item.group) {
				if (member.address) addresses.push(member.address);
			}
		}
	}

	return addresses;
}

function attachmentBytes(content: Attachment['content']): Uint8Array | null {
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (ArrayBuffer.isView(content)) {
		return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	}
	if (typeof content === 'string' && content.length > 0) {
		return new TextEncoder().encode(content);
	}
	return null;
}

async function inboundProviderId(input: {
	messageId: string | null;
	from: string;
	to: string;
	date: string | null | undefined;
	raw: ArrayBuffer;
}): Promise<string> {
	const contentHash = await crypto.subtle.digest('SHA-256', input.raw);
	const material = `${input.to.toLowerCase()}\n${input.messageId ?? ''}\n${[...new Uint8Array(contentHash)].join(',')}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `cf-${hex.slice(0, 32)}`;
}

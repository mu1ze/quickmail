import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEmailForUser, listThreadMessages } from '$lib/server/mail-store';
import { listSignatures } from '$lib/server/email-signature';
import { maybeRefreshThreadSummary, summaryModels } from '$lib/server/mail-summaries';
import { resolveReplyFromAddress } from '$lib/server/outbox';
import { displaySubject } from '$lib/server/threads';
import { loadThreadLabels } from '$lib/server/mail-labels';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const email = await getEmailForUser(platform.env.DB, locals.user.id, params.id);
	if (!email) {
		throw error(404, 'Email not found');
	}

	// No marking read here: hover preloading runs this load before the reader
	// opens anything. The page marks the conversation read once it mounts.
	const messages = await listThreadMessages(platform.env.DB, locals.user.id, email);

	const latest = messages[messages.length - 1] ?? email;
	const replyIdentity = await resolveReplyFromAddress(platform.env.DB, locals.user, latest);
	const signatures = await listSignatures(platform.env.DB, locals.user.id);

	if ((platform.env.AI || platform.env.OPENROUTER_API_KEY) && platform.ctx) {
		platform.ctx.waitUntil(
			maybeRefreshThreadSummary(platform.env.DB, summaryModels(platform.env), locals.user.id, {
				threadId: email.thread_id ?? email.id,
				latestId: latest.id,
				from: latest.from_addr,
				subject: latest.subject,
				body: latest.body_text ?? latest.body_html
			})
				.then(() => undefined)
				.catch(() => undefined)
		);
	}

	return {
		threadLabels: (await loadThreadLabels(platform.env.DB, locals.user.id, [email.thread_id ?? email.id])).get(email.thread_id ?? email.id) ?? [],
		threadId: email.thread_id ?? email.id,
		/** The linked message may also be expanded below the newest message. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		archived: Boolean(email.is_archived),
		spam: Boolean(email.is_spam),
		snoozedUntil: email.snoozed_until,
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		replyFrom: replyIdentity?.address ?? null,
		replyFromName: replyIdentity?.label?.trim() || null,
		signatures,
		addresses: locals.addresses,
		/** Anything still unread — the page marks the conversation read on open. */
		unread: messages.some((message) => !message.is_read),
		// Reader order is explicit in the server response, including first render.
		messages: messages.toReversed().map((message) => ({ ...message, is_read: true }))
	};
};

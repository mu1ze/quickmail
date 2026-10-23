import { analysisSearch } from '$lib/mail-analysis-search';
import { loadMailAnalyses, analysisInsertStatements } from './mail-analysis-store';
import type { AnalysisMetadata } from './subq';
import { parseMailSearch } from '$lib/mail-search';
import { loadThreadLabels } from './mail-labels';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { MAILBOX_PAGE_SIZE } from '$lib/constants';
import { MAX_BODY_BYTES } from './constants';
import { buildMessagePreview } from '$lib/utils/message-preview';
import { displaySubject, normalizeSubject, resolveThreadId } from './threads';
import { loadThreadSummaries } from './mail-summaries';
import { findVerificationCode, isDisposableCodeEmail, isRecentForCode, mightHaveVerificationCode } from '$lib/verification-code';
import type {
	DeliveryStatus,
	EmailAttachmentMeta,
	EmailRow,
	EmailSummary,
	MailboxCounts,
	MailboxPage,
	MailboxView,
	MailStatus,
	ThreadMessage,
	ThreadParticipant,
	ThreadSummary
} from '$lib/types';

export async function getUserIdByEmail(db: D1Database, email: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT id FROM users WHERE email = ?')
		.bind(email.toLowerCase())
		.first<{ id: string }>();

	return row?.id ?? null;
}

export async function insertEmail(
	db: D1Database,
	input: {
		userId: string;
		direction: 'inbound' | 'outbound';
		from: string;
		fromName?: string | null;
		analysisMetadata?: AnalysisMetadata;
		to: string;
		cc?: string | null;
		bcc?: string | null;
		subject: string;
		bodyText?: string | null;
		bodyHtml?: string | null;
		messageId?: string | null;
		inReplyTo?: string | null;
		references?: string | null;
		replyToEmailId?: string | null;
		domainId?: string | null;
		providerId?: string | null;
		status?: MailStatus | null;
		isRead?: boolean;
	}
): Promise<string> {
	const id = crypto.randomUUID();
	const bodyText = truncate(input.bodyText ?? null);
	const bodyHtml = truncate(input.bodyHtml ?? null);

	// Every message lands in a conversation before it is stored, so the list
	// view never has to guess.
	const threadId = await resolveThreadId(db, input.userId, {
		emailId: id,
		subject: input.subject,
		from: input.from,
		to: input.to,
		cc: input.cc,
		inReplyTo: input.inReplyTo,
		references: input.references,
		replyToEmailId: input.replyToEmailId,
		subjectMatch: input.status !== 'draft'
	});

	const insert = db
		.prepare(
			`INSERT INTO emails (
				id, user_id, direction, from_addr, from_name, to_addr, cc_addr, bcc_addr, subject,
				body_text, body_html, preview, message_id, in_reply_to, references_header,
				reply_to_email_id, thread_id, thread_key,
				domain_id, provider_id, status, status_at, is_read, code_cleanup_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?,
			 CASE WHEN ? = 1 AND EXISTS (SELECT 1 FROM mail_automations WHERE user_id = ? AND code_cleanup = 1)
			 THEN datetime('now', '+5 minutes') ELSE NULL END)`
		)
		.bind(
			id,
			input.userId,
			input.direction,
			input.from,
			input.fromName?.trim() || null,
			input.to,
			input.cc ?? null,
			input.bcc ?? null,
			input.subject,
			bodyText,
			bodyHtml,
			buildMessagePreview(bodyText, bodyHtml),
			input.messageId ?? null,
			input.inReplyTo ?? null,
			input.references ?? null,
			input.replyToEmailId ?? null,
			threadId,
			normalizeSubject(input.subject),
			input.domainId ?? null,
			input.providerId ?? null,
			input.status ?? null,
			input.isRead ? 1 : 0,
			input.direction === 'inbound' && isDisposableCodeEmail({ subject: input.subject, text: bodyText, html: bodyHtml }) ? 1 : 0,
			input.userId
		);

	if (input.direction === 'inbound') {
		await db.batch([insert, ...analysisInsertStatements(db, id, input.userId, input.analysisMetadata)]);
	} else { await insert.run(); }

	return id;
}

/** Already stored? Resend retries webhooks, so inbound writes must be idempotent. */
export async function emailExistsByProviderId(
	db: D1Database,
	providerId: string
): Promise<boolean> {
	const row = await db
		.prepare('SELECT id FROM emails WHERE provider_id = ?')
		.bind(providerId)
		.first<{ id: string }>();
	return Boolean(row);
}

/** Applied when Resend reports delivery/bounce/complaint on something we sent. */
export async function updateEmailStatusByProviderId(
	db: D1Database,
	providerId: string,
	status: DeliveryStatus,
	detail?: string | null
): Promise<void> {
	await db
		.prepare(
			`UPDATE emails SET status = ?, status_at = datetime('now'), status_detail = ?
			 WHERE provider_id = ?`
		)
		.bind(status, detail ?? null, providerId)
		.run();
}

/**
 * Every mailbox is a slice of the same table: Drafts are unsent outbound rows,
 * Trash is anything with `deleted_at`, and the rest hide trashed mail. A
 * conversation shows up in a mailbox when any of its messages match.
 */
function viewFilter(view: MailboxView | 'anywhere'): string {
	switch (view) {
		case 'anywhere': return '1 = 1';
		case 'inbox':
			return "e.deleted_at IS NULL AND e.is_archived = 0 AND e.is_spam = 0 AND e.direction = 'inbound' AND (e.snoozed_until IS NULL OR e.snoozed_until <= datetime('now'))";
		case 'sent':
			return "e.deleted_at IS NULL AND e.is_spam = 0 AND e.direction = 'outbound' AND (e.status IS NULL OR e.status <> 'draft')";
		case 'drafts':
			return "e.deleted_at IS NULL AND e.status = 'draft'";
		case 'starred':
			return "e.deleted_at IS NULL AND e.is_spam = 0 AND e.is_starred = 1 AND (e.status IS NULL OR e.status <> 'draft')";
		case 'later':
			return "e.deleted_at IS NULL AND e.is_spam = 0 AND e.snoozed_until IS NOT NULL AND e.snoozed_until > datetime('now')";
		case 'all':
			return "e.deleted_at IS NULL AND e.is_spam = 0 AND (e.status IS NULL OR e.status <> 'draft')";
		case 'spam':
			return "e.deleted_at IS NULL AND e.is_spam = 1 AND (e.status IS NULL OR e.status <> 'draft')";
		case 'trash':
			return 'e.deleted_at IS NOT NULL';
	}
}

/**
 * Which messages of a matched conversation are actually rendered. Wider than
 * `viewFilter` on purpose — an inbox row counts the replies we sent too, so it
 * reads as one conversation rather than a matched message.
 */
function displayFilter(view: MailboxView | 'anywhere', alias: string): string {
	switch (view) {
		case 'anywhere': return '1 = 1';
		case 'trash':
			return `${alias}.deleted_at IS NOT NULL`;
		case 'drafts':
			return `${alias}.deleted_at IS NULL AND ${alias}.status = 'draft'`;
		default:
			return `${alias}.deleted_at IS NULL AND (${alias}.status IS NULL OR ${alias}.status <> 'draft')`;
	}
}

export type MailboxQuery = {
	labelId?: string;
	view: MailboxView;
	/** Restrict to one connected domain; omit for the combined view. */
	domainId?: string | null;
	/** Free text matched against participants, subject and body. */
	q?: string | null;
	category?: string;
	needs?: string;
	unreadOnly?: boolean;
	starredOnly?: boolean;
	attachmentsOnly?: boolean;
	page?: number;
	pageSize?: number;
};

type ThreadMessageRow = {
	is_archived: number;
	id: string;
	thread_id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	subject: string;
	preview: string | null;
	is_read: number;
	is_starred: number;
	is_pinned: number;
	has_attachments: number;
	domain_id: string | null;
	status: MailStatus | null;
	snoozed_until: string | null;
	auto_trashed_at: string | null;
	created_at: string;
};

/** Builds the WHERE clause and bindings shared by the count and the page query. */
function buildScope(userId: string, query: MailboxQuery): { where: string; bindings: unknown[] } {
	const search = parseMailSearch(query.q ?? '');
	const filters = ['e.user_id = ?', viewFilter(search.view ?? query.view)];
	const bindings: unknown[] = [userId];

	if (query.domainId) {
		filters.push('e.domain_id = ?');
		bindings.push(query.domainId);
	}
	if (query.labelId) {
		filters.push(`EXISTS(SELECT 1 FROM email_labels el JOIN emails labeled ON labeled.id = el.email_id
			JOIN mail_labels l ON l.id = el.label_id WHERE el.label_id = ? AND l.user_id = e.user_id
			AND labeled.user_id = e.user_id AND COALESCE(labeled.thread_id, labeled.id) = COALESCE(e.thread_id, e.id))`);
		bindings.push(query.labelId);
	}

	for (const [operator, value] of [['category', query.category], ['needs', query.needs]]) {
		const analysis = value ? analysisSearch(operator!, value) : null;
		if (analysis) { filters.push(analysis.condition); bindings.push(...analysis.bindings); }
	}
	filters.push(...search.conditions);
	bindings.push(...search.bindings);

	if (query.unreadOnly) filters.push('e.is_read = 0');
	if (query.starredOnly) filters.push('e.is_starred = 1');
	if (query.attachmentsOnly) {
		filters.push('EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)');
	}

	return { where: filters.join(' AND '), bindings };
}

/**
 * One page of conversations. Filters match individual messages, but the unit of
 * the list is the thread they belong to, ordered by its most recent message.
 */
export async function listMailbox(
	db: D1Database,
	userId: string,
	query: MailboxQuery
): Promise<MailboxPage> {
	const { where, bindings } = buildScope(userId, query);
	const pageSize = query.pageSize ?? MAILBOX_PAGE_SIZE;
	const display = displayFilter(parseMailSearch(query.q ?? '').view ?? query.view, 'm');

	const totalRow = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM (
				SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
			)`
		)
		.bind(...bindings)
		.first<{ count: number }>();

	const total = totalRow?.count ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(1, query.page ?? 1), pageCount);

	if (total === 0) {
		return { threads: [], total, page, pageCount, pageSize };
	}

	const { results: rows } = await db
		.prepare(
			`SELECT t.thread_id, MAX(datetime(m.created_at)) AS last_at, MAX(m.is_pinned) AS pinned
			 FROM (
				SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
			 ) t
			 JOIN emails m
			   ON m.user_id = ? AND COALESCE(m.thread_id, m.id) = t.thread_id AND ${display}
			 GROUP BY t.thread_id
			 ORDER BY pinned DESC, last_at DESC
			 LIMIT ? OFFSET ?`
		)
		.bind(...bindings, userId, pageSize, (page - 1) * pageSize)
		.all<{ thread_id: string; last_at: string }>();

	const threadIds = rows.map((row) => row.thread_id);
	if (threadIds.length === 0) {
		return { threads: [], total, page, pageCount, pageSize };
	}

	const placeholders = threadIds.map(() => '?').join(', ');
	const { results: messages } = await db
		.prepare(
			`SELECT m.id, COALESCE(m.thread_id, m.id) AS thread_id, m.direction, m.from_addr, m.from_name, m.to_addr,
			        m.subject, m.is_read, m.is_starred, m.is_pinned, m.is_archived, m.created_at, m.domain_id, m.status, m.snoozed_until,
			        m.auto_trashed_at, m.preview,
			        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = m.id) AS has_attachments
			 FROM emails m
			 WHERE m.user_id = ? AND COALESCE(m.thread_id, m.id) IN (${placeholders}) AND ${display}
			 ORDER BY datetime(m.created_at) ASC,m.rowid ASC`
		)
		.bind(userId, ...threadIds)
		.all<ThreadMessageRow>();

	const byThread = new Map<string, ThreadMessageRow[]>();
	for (const message of messages) {
		const bucket = byThread.get(message.thread_id);
		if (bucket) bucket.push(message);
		else byThread.set(message.thread_id, [message]);
	}

	const threads = threadIds
		.map((threadId) => byThread.get(threadId))
		.filter((group): group is ThreadMessageRow[] => Boolean(group?.length))
		.map(toThreadSummary);
	await fillMissingPreviews(db, userId, threads.map((thread) => thread.latest_id), (id, preview) => {
		const thread = threads.find((entry) => entry.latest_id === id);
		if (thread) thread.preview = preview;
	}, messages);
	await attachVerificationCodes(db, userId, threads, byThread);
	const names = await knownSenderNames(db, userId, messages);
	for (const thread of threads) {
		for (const person of thread.participants) {
			if (!person.self && !person.name?.trim()) person.name = names.get(person.address.toLowerCase()) ?? null;
		}
	}

	const { results: inbound } = await db.prepare(`SELECT id,COALESCE(thread_id,id) AS thread_id FROM emails WHERE user_id=? AND direction='inbound' AND deleted_at IS NULL AND COALESCE(thread_id,id) IN (${placeholders}) ORDER BY datetime(created_at),rowid`)
		.bind(userId,...threadIds).all<{id:string;thread_id:string}>();
	const analyses = await loadMailAnalyses(db,userId,inbound.map(m=>m.id));
	for (const thread of threads) {
		const group = inbound.filter(m=>m.thread_id===thread.thread_id);
		const latest = group.at(-1);
		if (!latest) continue;
		const base = analyses.get(latest.id);
		const flagged = (key: 'phishing'|'spam'|'needsReply'|'deadline'|'review') => group.findLast(m=>analyses.get(m.id)?.[key]);
		const phishing = flagged('phishing'), spam = flagged('spam'), reply = base?.needsReply ? latest : undefined, deadline = base?.deadline ? latest : undefined;
		const review = group.some(m=>analyses.get(m.id)?.status==='failed') || Boolean(base?.review);
		if (base || phishing || spam || reply || deadline || review) {
			thread.analysis = { ...(base ?? {emailId:latest.id,status:'pending',category:null,suggested:false,confidence:null,corrected:false,urgency:null}), review:review || Boolean(phishing || spam), phishing:Boolean(phishing), spam:Boolean(spam),needsReply:Boolean(reply),deadline:Boolean(deadline) };
			thread.analysisMessageId=latest.id;
			thread.analysisPhishingId=phishing?.id;thread.analysisSpamId=spam?.id;
			thread.analysisReplyId=reply?.id;thread.analysisDeadlineId=deadline?.id;
		}
	}

	const summaries = await loadThreadSummaries(
		db,
		userId,
		threads.map((thread) => thread.thread_id)
	);
	const labels = await loadThreadLabels(db, userId, threadIds);
	for (const thread of threads) {
		thread.labels = labels.get(thread.thread_id) ?? [];
		const summary = summaries.get(thread.thread_id);
		if (summary && summary.source_latest_id === thread.latest_id) {
			thread.preview = buildMessagePreview(summary.summary);
		}
	}

	return { threads, total, page, pageCount, pageSize };
}

/**
 * Messages stored before previews were persisted have preview = NULL. Compute
 * those once from the body (only the rows being shown), save the result, and
 * hand it back; after that the list never touches a body again.
 */
async function fillMissingPreviews(
	db: D1Database,
	userId: string,
	ids: string[],
	apply: (id: string, preview: string) => void,
	known: { id: string; preview: string | null }[] = []
): Promise<void> {
	const missing = ids.filter((id) => {
		const row = known.find((entry) => entry.id === id);
		return row ? row.preview === null : true;
	});
	if (!missing.length) return;
	const { results } = await db
		.prepare(
			`SELECT id, body_text, body_html FROM emails
			 WHERE user_id = ? AND preview IS NULL AND id IN (${missing.map(() => '?').join(', ')})`
		)
		.bind(userId, ...missing)
		.all<{ id: string; body_text: string | null; body_html: string | null }>();
	if (!results.length) return;
	const computed = results.map((row) => ({ id: row.id, preview: buildMessagePreview(row.body_text, row.body_html) }));
	for (const { id, preview } of computed) apply(id, preview);
	await db.batch(
		computed.map(({ id, preview }) =>
			db.prepare('UPDATE emails SET preview = ? WHERE id = ? AND user_id = ? AND preview IS NULL').bind(preview, id, userId)
		)
	);
}

/** Recover missing names from this account's other mail, never another user. */
async function knownSenderNames(
	db: D1Database, userId: string,
	messages: { direction: string; from_addr: string; from_name?: string | null }[]
): Promise<Map<string, string>> {
	const addresses = [...new Set(messages.filter((m) => m.direction === 'inbound' && !m.from_name?.trim())
		.map((m) => m.from_addr.toLowerCase()))];
	if (!addresses.length) return new Map();
	const { results } = await db.prepare(`SELECT from_addr, from_name FROM (
		SELECT from_addr, from_name, ROW_NUMBER() OVER (
			PARTITION BY LOWER(from_addr) ORDER BY datetime(created_at) DESC, rowid DESC
		) AS name_rank FROM emails
		WHERE user_id = ? AND direction = 'inbound' AND LOWER(from_addr) IN (${addresses.map(() => '?').join(',')})
		AND TRIM(COALESCE(from_name, '')) <> ''
	) WHERE name_rank = 1`)
		.bind(userId, ...addresses).all<{ from_addr: string; from_name: string }>();
	const names = new Map<string, string>();
	for (const row of results) {
		const address = row.from_addr.toLowerCase();
		if (!names.has(address)) names.set(address, row.from_name.trim());
	}
	return names;
}

/**
 * Recent sign-in mail shows its code right on the row. Only rows that look
 * like it have their bodies read, and older codes have expired anyway.
 */
async function attachVerificationCodes(
	db: D1Database,
	userId: string,
	threads: ThreadSummary[],
	byThread: Map<string, ThreadMessageRow[]>
): Promise<void> {
	const now = Date.now();
	const ids = threads
		.filter((thread) => {
			const latest = byThread.get(thread.thread_id)?.at(-1);
			return (
				latest?.direction === 'inbound' &&
				latest.status !== 'draft' &&
				isRecentForCode(latest.created_at, now) &&
				mightHaveVerificationCode(latest.subject, latest.preview ?? thread.preview)
			);
		})
		.map((thread) => thread.latest_id)
		.slice(0, 20);
	if (ids.length === 0) return;
	try {
		const { results } = await db
			.prepare(
				`SELECT id, subject, substr(body_text, 1, 8000) AS body_text, substr(body_html, 1, 60000) AS body_html
				 FROM emails WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})`
			)
			.bind(userId, ...ids)
			.all<{ id: string; subject: string; body_text: string | null; body_html: string | null }>();
		for (const row of results) {
			const code = findVerificationCode({ subject: row.subject, text: row.body_text, html: row.body_html });
			const thread = threads.find((entry) => entry.latest_id === row.id);
			if (code && thread) thread.verification_code = code;
		}
	} catch {
		// A missing code never breaks the mailbox.
	}
}

/** `messages` is the whole conversation, oldest first. */
function toThreadSummary(messages: ThreadMessageRow[]): ThreadSummary {
	const oldest = messages[0];
	const latest = messages[messages.length - 1];

	// Senders in the order they first spoke, with our own identities collapsed
	// into a single "me" the way a conversation header reads.
	const participants: ThreadParticipant[] = [];
	for (const message of messages) {
		if (message.direction === 'outbound') {
			if (!participants.some((entry) => entry.self)) {
				participants.push({ label: 'me', address: message.from_addr, self: true });
			}
			continue;
		}

		const address = message.from_addr;
		const seen = participants.find(
			(entry) => !entry.self && entry.address.toLowerCase() === address.toLowerCase()
		);
		if (seen) {
			if (message.from_name?.trim()) seen.name = message.from_name.trim();
			continue;
		}

		participants.push({ label: displayNameFor(address), name: message.from_name, address, self: false });
	}

	return {
		thread_id: oldest.thread_id,
		latest_id: latest.id,
		// The conversation keeps the subject it started with, not "Re: Re: …".
		subject: latest.status === 'draft' ? latest.subject : displaySubject(oldest.subject),
		preview: latest.preview ?? '',
		participants,
		message_count: messages.length,
		is_read: messages.every((message) => message.is_read === 1),
		is_archived: messages.every((message) => message.is_archived === 1),
		is_starred: messages.some((message) => message.is_starred === 1),
		is_pinned: messages.some((message) => message.is_pinned === 1),
		is_draft: latest.status === 'draft',
		has_attachments: messages.some((message) => message.has_attachments === 1),
		domain_id: latest.domain_id,
		status: latest.status === 'draft' ? null : latest.status,
		snoozed_until:
			messages
				.map((message) => message.snoozed_until)
				.filter((value): value is string => Boolean(value))
				.sort()
				.at(-1) ?? null,
		auto_trashed: messages.some((message) => Boolean(message.auto_trashed_at)),
		created_at: latest.created_at
	};
}

/** Legacy short label for APIs; supplied names are kept separately. */
function displayNameFor(address: string): string {
	if (!address) return 'Unknown';
	const [local] = address.split('@');
	return local.replace(/[._-]+/g, ' ');
}

/** Flat message list, used by the JSON API rather than the mailbox UI. */
export async function listEmails(
	db: D1Database,
	userId: string,
	options: {
		direction?: 'inbound' | 'outbound';
		domainId?: string | null;
		limit?: number;
	} = {}
): Promise<EmailSummary[]> {
	const view: MailboxView = options.direction === 'outbound' ? 'sent' : 'inbox';
	const { where, bindings } = buildScope(userId, { view, domainId: options.domainId });

	const { results } = await db
		.prepare(
			`SELECT e.id, e.direction, e.from_addr, e.to_addr, e.subject, e.is_read, e.is_starred,
			        e.created_at, e.domain_id, e.status,
		        e.preview,
			        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id) AS has_attachments
			 FROM emails e
			 WHERE ${where}
			 ORDER BY datetime(e.created_at) DESC
			 LIMIT ?`
		)
		.bind(...bindings, options.limit ?? 100)
		.all<ThreadMessageRow>();

	await fillMissingPreviews(db, userId, results.map((row) => row.id), (id, preview) => {
		const row = results.find((entry) => entry.id === id);
		if (row) row.preview = preview;
	});

	return results.map((row) => ({
		id: row.id,
		direction: row.direction,
		from_addr: row.from_addr,
		to_addr: row.to_addr,
		subject: row.subject,
		preview: row.preview ?? '',
		is_read: row.is_read === 1,
		is_starred: row.is_starred === 1,
		is_draft: row.status === 'draft',
		has_attachments: row.has_attachments === 1,
		domain_id: row.domain_id,
		status: row.status === 'draft' ? null : row.status,
		created_at: row.created_at
	}));
}

/**
 * Row counts behind every sidebar entry, in one round trip. Counted in
 * conversations so the badges agree with what the lists actually show.
 */
export async function getMailboxCounts(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<MailboxCounts> {
	const bindings: unknown[] = [userId];
	let scope = 'user_id = ?';
	if (domainId) {
		scope += ' AND domain_id = ?';
		bindings.push(domainId);
	}

	const thread = 'COALESCE(thread_id, id)';

	const row = await db
		.prepare(
			`SELECT
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_archived = 0 AND is_spam = 0 AND direction = 'inbound' AND (snoozed_until IS NULL OR snoozed_until <= datetime('now')) THEN ${thread} END) AS inbox,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_archived = 0 AND is_spam = 0 AND direction = 'inbound' AND is_read = 0 AND (snoozed_until IS NULL OR snoozed_until <= datetime('now')) THEN ${thread} END) AS inbox_unread,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_spam = 0 AND is_starred = 1 AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS starred,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND status = 'draft' THEN ${thread} END) AS drafts,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_spam = 0 AND direction = 'outbound' AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS sent,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_spam = 0 AND snoozed_until IS NOT NULL AND snoozed_until > datetime('now') THEN ${thread} END) AS later,
				COUNT(DISTINCT CASE WHEN deleted_at IS NOT NULL THEN ${thread} END) AS trash
			 FROM emails WHERE ${scope}`
		)
		.bind(...bindings)
		.first<Record<keyof MailboxCounts, number | null>>();

	return {
		inbox: row?.inbox ?? 0,
		inbox_unread: row?.inbox_unread ?? 0,
		starred: row?.starred ?? 0,
		drafts: row?.drafts ?? 0,
		sent: row?.sent ?? 0,
		later: row?.later ?? 0,
		trash: row?.trash ?? 0
	};
}

export async function countUnread(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<number> {
	const counts = await getMailboxCounts(db, userId, domainId);
	return counts.inbox_unread;
}

/**
 * Widens a set of message ids to every message in the same conversations.
 * List actions read as conversation actions — trashing a thread trashes the
 * replies with it.
 */
export async function expandToThreads(
	db: D1Database,
	userId: string,
	ids: string[]
): Promise<string[]> {
	if (ids.length === 0) return [];

	const placeholders = ids.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT id FROM emails
			 WHERE user_id = ?
			 AND COALESCE(thread_id, id) IN (
				SELECT COALESCE(thread_id, id) FROM emails WHERE user_id = ? AND id IN (${placeholders})
			 )`
		)
		.bind(userId, userId, ...ids)
		.all<{ id: string }>();

	return results.map((row) => row.id);
}

export type MailFlagUpdate = {
	isRead?: boolean;
	isStarred?: boolean;
	isPinned?: boolean;
	trashed?: boolean;
	isArchived?: boolean;
	isSpam?: boolean;
	/** SQLite datetime; `null` wakes a snoozed conversation. */
	snoozedUntil?: string | null;
};

/** Applies list actions (read/unread, star, trash, restore) to a set of rows. */
export async function setEmailFlags(
	db: D1Database,
	userId: string,
	ids: string[],
	update: MailFlagUpdate
): Promise<number> {
	if (ids.length === 0) return 0;

	const assignments: string[] = [];
	const bindings: unknown[] = [];

	if (update.isRead !== undefined) {
		assignments.push('is_read = ?');
		bindings.push(update.isRead ? 1 : 0);
	}
	if (update.isStarred !== undefined) {
		assignments.push('is_starred = ?');
		bindings.push(update.isStarred ? 1 : 0);
	}
	if (update.isPinned !== undefined) {
		assignments.push('is_pinned = ?');
		bindings.push(update.isPinned ? 1 : 0);
	}
	if (update.isArchived !== undefined) {
		assignments.push('is_archived = ?');
		bindings.push(update.isArchived ? 1 : 0);
	}
	if (update.isSpam !== undefined) {
		assignments.push('is_spam = ?');
		bindings.push(update.isSpam ? 1 : 0);
		assignments.push('snoozed_until = NULL');
	}
	if (update.trashed !== undefined) {
		assignments.push(update.trashed ? "deleted_at = datetime('now')" : 'deleted_at = NULL');
		if (update.trashed) {
			assignments.push('snoozed_until = NULL');
		} else {
			assignments.push('auto_trashed_at = NULL');
			assignments.push('auto_trash_reason = NULL');
		}
	}
	if (update.snoozedUntil !== undefined) {
		if (update.snoozedUntil) {
			assignments.push('snoozed_until = ?');
			bindings.push(update.snoozedUntil);
			assignments.push('deleted_at = NULL');
			assignments.push('is_read = 1');
		} else {
			assignments.push('snoozed_until = NULL');
		}
	}
	// Keeping, moving, or restoring a message cancels its one-time deadline.
	// A restored code must not disappear again on the next scheduled pass.
	if (update.trashed !== undefined || update.isStarred || update.isPinned || update.isArchived || update.isSpam || update.snoozedUntil) {
		assignments.push('code_cleanup_at = NULL');
	}

	if (assignments.length === 0) return 0;

	const placeholders = ids.map(() => '?').join(', ');
	const result = await db
		.prepare(
			`UPDATE emails SET ${assignments.join(', ')}
			 WHERE user_id = ? AND id IN (${placeholders})`
		)
		.bind(...bindings, userId, ...ids)
		.run();

	return result.meta?.changes ?? 0;
}

/** Irreversible: drops the rows and the R2 objects their attachments point at. */
export async function deleteEmailsPermanently(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string,
	ids: string[]
): Promise<number> {
	if (ids.length === 0) return 0;

	const placeholders = ids.map(() => '?').join(', ');
	const owned = await db
		.prepare(`SELECT id FROM emails WHERE user_id = ? AND id IN (${placeholders})`)
		.bind(userId, ...ids)
		.all<{ id: string }>();

	const ownedIds = owned.results.map((row) => row.id);
	if (ownedIds.length === 0) return 0;

	const ownedPlaceholders = ownedIds.map(() => '?').join(', ');

	if (bucket) {
		const { results: files } = await db
			.prepare(
				`SELECT storage_key FROM email_attachments
				 WHERE email_id IN (${ownedPlaceholders}) AND storage_key IS NOT NULL`
			)
			.bind(...ownedIds)
			.all<{ storage_key: string }>();

		await Promise.all(files.map((file) => bucket.delete(file.storage_key)));
	}

	// Older D1 databases were created without ON DELETE CASCADE enforcement,
	// so clear the children explicitly.
	await db
		.prepare(`DELETE FROM email_attachments WHERE email_id IN (${ownedPlaceholders})`)
		.bind(...ownedIds)
		.run();

	await db
		.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${ownedPlaceholders})`)
		.bind(userId, ...ownedIds)
		.run();

	return ownedIds.length;
}

/** "Mark all as read" from the list menu — scoped to the active domain filter. */
export async function markAllRead(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<number> {
	const bindings: unknown[] = [userId];
	let scope = "user_id = ? AND direction = 'inbound' AND deleted_at IS NULL AND is_read = 0";
	if (domainId) {
		scope += ' AND domain_id = ?';
		bindings.push(domainId);
	}

	const result = await db
		.prepare(`UPDATE emails SET is_read = 1 WHERE ${scope}`)
		.bind(...bindings)
		.run();

	return result.meta?.changes ?? 0;
}

export async function emptyTrash(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string
): Promise<number> {
	const { results } = await db
		.prepare('SELECT id FROM emails WHERE user_id = ? AND deleted_at IS NOT NULL')
		.bind(userId)
		.all<{ id: string }>();

	return deleteEmailsPermanently(
		db,
		bucket,
		userId,
		results.map((row) => row.id)
	);
}

export type DraftInput = {
	id?: string | null;
	from: string;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	bodyText?: string | null;
	bodyHtml?: string | null;
	domainId?: string | null;
};

/** Creates or updates a draft; drafts are outbound rows Resend never saw. */
export async function saveDraft(
	db: D1Database,
	userId: string,
	input: DraftInput
): Promise<string> {
	if (input.id) {
		const existing = await db
			.prepare("SELECT id FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
			.bind(input.id, userId)
			.first<{ id: string }>();

		if (existing) {
			await db
				.prepare(
					`UPDATE emails SET from_addr = ?, to_addr = ?, cc_addr = ?, bcc_addr = ?,
					        subject = ?, thread_key = ?, body_text = ?, body_html = ?, preview = ?, domain_id = ?,
					        created_at = datetime('now'), deleted_at = NULL
					 WHERE id = ? AND user_id = ?`
				)
				.bind(
					input.from,
					input.to,
					input.cc ?? null,
					input.bcc ?? null,
					input.subject,
					normalizeSubject(input.subject),
					input.bodyText ?? null,
					input.bodyHtml ?? null,
					buildMessagePreview(input.bodyText ?? null, input.bodyHtml ?? null),
					input.domainId ?? null,
					input.id,
					userId
				)
				.run();

			return input.id;
		}
	}

	return insertEmail(db, {
		userId,
		direction: 'outbound',
		from: input.from,
		to: input.to,
		cc: input.cc ?? null,
		bcc: input.bcc ?? null,
		subject: input.subject,
		bodyText: input.bodyText ?? null,
		bodyHtml: input.bodyHtml ?? null,
		domainId: input.domainId ?? null,
		status: 'draft',
		isRead: true
	});
}

export async function getDraft(
	db: D1Database,
	userId: string,
	draftId: string
): Promise<EmailRow | null> {
	const row = await db
		.prepare("SELECT * FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
		.bind(draftId, userId)
		.first<EmailRow>();

	return row ?? null;
}

export async function deleteDraft(db: D1Database, userId: string, draftId: string, bucket?: R2Bucket): Promise<void> {
	const draft = await getDraft(db, userId, draftId);
	if (draft) await deleteEmailsPermanently(db, bucket, userId, [draft.id]);
}

export async function getEmailForUser(
	db: D1Database,
	userId: string,
	emailId: string
): Promise<EmailRow | null> {
	const row = await db
		.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
		.bind(emailId, userId)
		.first<EmailRow>();

	return row ?? null;
}

/**
 * The whole conversation an email belongs to, oldest first — both directions,
 * which is the point: a reply from the other side is part of the thread, not a
 * new message in the inbox.
 */
export async function listThreadMessages(
	db: D1Database,
	userId: string,
	email: EmailRow
): Promise<ThreadMessage[]> {
	const threadId = email.thread_id ?? email.id;

	// Opening a trashed message shows the trashed conversation; otherwise the
	// live one. Drafts are edited in the composer, never inline.
	const scope = email.deleted_at ? '' : 'AND e.deleted_at IS NULL';

	const { results } = await db
		.prepare(
			`SELECT e.id, e.direction, e.from_addr, e.from_name, e.to_addr, e.cc_addr, e.bcc_addr, e.subject,
			        e.body_text, e.body_html, e.message_id, e.references_header,
			        e.status, e.status_detail, e.is_read, e.is_starred, e.is_pinned, e.deleted_at, e.created_at, e.code_cleanup_at
			 FROM emails e
			 WHERE e.user_id = ?
			 AND COALESCE(e.thread_id, e.id) = ?
			 AND (e.status IS NULL OR e.status <> 'draft')
			 ${scope}
			 ORDER BY datetime(e.created_at) ASC,e.rowid ASC`
		)
		.bind(userId, threadId)
		.all<
			Omit<ThreadMessage, 'attachments' | 'is_read' | 'is_starred' | 'is_pinned'> & {
				is_read: number;
				is_starred: number;
				is_pinned: number;
			}
		>();

	if (results.length === 0) return [];

	// Every message in the thread can carry attachments — one round trip for all.
	const placeholders = results.map(() => '?').join(', ');
	const { results: files } = await db
		.prepare(
			`SELECT id, email_id, filename, content_type, size_bytes, created_at, content_id, disposition
			 FROM email_attachments
			 WHERE email_id IN (${placeholders})
			 ORDER BY created_at ASC`
		)
		.bind(...results.map((message) => message.id))
		.all<EmailAttachmentMeta>();

	const analyses = await loadMailAnalyses(db,userId,results.map(m=>m.id));
	const names = await knownSenderNames(db, userId, results);

	// The query already filters drafts out, so `status` is a delivery state or null
	// and needs no further narrowing here.
	return results.map((message) => ({
		...message,
		from_name: message.from_name?.trim() || names.get(message.from_addr.toLowerCase()) || null,
		is_read: message.is_read === 1,
		is_starred: message.is_starred === 1,
		is_pinned: message.is_pinned === 1,
		analysis: analyses.get(message.id),
		attachments: files.filter((file) => file.email_id === message.id)
	}));
}

/** Opening a conversation clears the unread state on all of its messages. */
export async function markThreadRead(
	db: D1Database,
	userId: string,
	email: EmailRow
): Promise<void> {
	await db
		.prepare(
			`UPDATE emails SET is_read = 1
			 WHERE user_id = ? AND COALESCE(thread_id, id) = ? AND deleted_at IS NULL`
		)
		.bind(userId, email.thread_id ?? email.id)
		.run();
}

export type RecentContact = {
	address: string;
	last_at: string;
};

/** People you've written to or heard from, for the composer typeahead. */
export async function listRecentContacts(
	db: D1Database,
	userId: string,
	query: string,
	exclude: Set<string>
): Promise<RecentContact[]> {
	const { results: inbound } = await db
		.prepare(
			`SELECT from_addr AS address, created_at AS last_at
			 FROM emails
			 WHERE user_id = ? AND direction = 'inbound' AND deleted_at IS NULL
			 ORDER BY datetime(created_at) DESC
			 LIMIT 80`
		)
		.bind(userId)
		.all<{ address: string; last_at: string }>();

	const { results: outbound } = await db
		.prepare(
			`SELECT to_addr AS address, created_at AS last_at
			 FROM emails
			 WHERE user_id = ? AND direction = 'outbound' AND deleted_at IS NULL
			   AND (status IS NULL OR status <> 'draft')
			 ORDER BY datetime(created_at) DESC
			 LIMIT 80`
		)
		.bind(userId)
		.all<{ address: string; last_at: string }>();

	const needle = query.trim().toLowerCase();
	const best = new Map<string, RecentContact>();

	for (const row of [...inbound, ...outbound]) {
		for (const part of row.address.split(/[,;]+/)) {
			const address = part.trim().toLowerCase();
			if (!address.includes('@') || exclude.has(address)) continue;
			if (needle && !address.includes(needle)) continue;
			const existing = best.get(address);
			if (!existing || existing.last_at < row.last_at) {
				best.set(address, { address, last_at: row.last_at });
			}
		}
	}

	return [...best.values()]
		.sort((a, b) => (a.last_at < b.last_at ? 1 : -1))
		.slice(0, 8);
}

function truncate(value: string | null): string | null {
	if (!value) return null;
	if (value.length <= MAX_BODY_BYTES) return value;
	return value.slice(0, MAX_BODY_BYTES);
}

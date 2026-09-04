import type { D1Database } from '@cloudflare/workers-types';
import { extractAiText } from './mail-classify';
import { htmlToPreviewText } from '$lib/utils/message-preview';

export const SUMMARY_BATCH = 20;
export const SUMMARY_MAX_CHARS = 220;
export const AI_SUMMARY_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export type WorkersAiBinding = {
	run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
};

export type ThreadSummaryRow = {
	thread_id: string;
	summary: string;
	source_latest_id: string;
};

type OpenedThread = {
	thread_id: string;
	latest_id: string;
	from_addr: string;
	subject: string;
	body_head: string | null;
};

function previewBody(body: string | null): string {
	if (!body) return '';
	const text = /<[a-z][\s\S]*>/i.test(body) ? htmlToPreviewText(body) : body;
	return text.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

export function parseAiSummaryResponse(raw: unknown): string | null {
	let text = extractAiText(raw);
	if (!text) return null;
	const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
	if (fenced?.[1]) text = fenced[1];
	const cleaned = text
		.replace(/^["']|["']$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned || cleaned.length < 8) return null;
	return cleaned.slice(0, SUMMARY_MAX_CHARS);
}

export async function loadThreadSummaries(
	db: D1Database,
	userId: string,
	threadIds: string[]
): Promise<Map<string, ThreadSummaryRow>> {
	const map = new Map<string, ThreadSummaryRow>();
	if (threadIds.length === 0) return map;

	const placeholders = threadIds.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT thread_id, summary, source_latest_id
			 FROM thread_summaries
			 WHERE user_id = ? AND thread_id IN (${placeholders})`
		)
		.bind(userId, ...threadIds)
		.all<ThreadSummaryRow>();

	for (const row of results) {
		map.set(row.thread_id, row);
	}
	return map;
}

export async function saveThreadSummary(
	db: D1Database,
	userId: string,
	row: ThreadSummaryRow
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO thread_summaries (user_id, thread_id, summary, source_latest_id, updated_at)
			 VALUES (?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, thread_id) DO UPDATE SET
				summary = excluded.summary,
				source_latest_id = excluded.source_latest_id,
				updated_at = datetime('now')`
		)
		.bind(userId, row.thread_id, row.summary, row.source_latest_id)
		.run();
}

async function generateSummary(ai: WorkersAiBinding, thread: OpenedThread): Promise<string | null> {
	try {
		const raw = await ai.run(AI_SUMMARY_MODEL, {
			messages: [
				{
					role: 'system',
					content:
						'Summarize opened email for an inbox row. At most two short sentences. Plain text. No greeting.'
				},
				{
					role: 'user',
					content: `From: ${thread.from_addr}\nSubject: ${thread.subject}\nBody: ${previewBody(thread.body_head)}`
				}
			],
			max_tokens: 120
		});
		return parseAiSummaryResponse(raw);
	} catch {
		return null;
	}
}

async function listOpenedThreadsNeedingSummary(
	db: D1Database,
	userId: string,
	limit = SUMMARY_BATCH
): Promise<OpenedThread[]> {
	const { results } = await db
		.prepare(
			`SELECT COALESCE(e.thread_id, e.id) AS thread_id, e.id AS latest_id, e.from_addr, e.subject,
			        substr(COALESCE(NULLIF(trim(e.body_text), ''), e.body_html, ''), 1, 4000) AS body_head
			 FROM emails e
			 WHERE e.user_id = ?
			   AND e.direction = 'inbound'
			   AND e.is_read = 1
			   AND e.deleted_at IS NULL
			   AND datetime(e.created_at) = (
					SELECT MAX(datetime(m.created_at)) FROM emails m
					 WHERE m.user_id = e.user_id AND COALESCE(m.thread_id, m.id) = COALESCE(e.thread_id, e.id)
					   AND m.deleted_at IS NULL
			   )
			   AND NOT EXISTS (
					SELECT 1 FROM thread_summaries s
					 WHERE s.user_id = e.user_id
					   AND s.thread_id = COALESCE(e.thread_id, e.id)
					   AND s.source_latest_id = e.id
			   )
			 ORDER BY datetime(e.created_at) DESC
			 LIMIT ?`
		)
		.bind(userId, limit)
		.all<OpenedThread>();

	return results;
}

export async function backfillThreadSummaries(
	db: D1Database,
	userId: string,
	ai: WorkersAiBinding
): Promise<number> {
	const threads = await listOpenedThreadsNeedingSummary(db, userId);
	let written = 0;

	for (const thread of threads) {
		const summary = await generateSummary(ai, thread);
		if (!summary) continue;
		await saveThreadSummary(db, userId, {
			thread_id: thread.thread_id,
			summary,
			source_latest_id: thread.latest_id
		});
		written += 1;
	}

	return written;
}

export async function maybeRefreshThreadSummary(
	db: D1Database,
	ai: WorkersAiBinding | null | undefined,
	userId: string,
	thread: { threadId: string; latestId: string; from: string; subject: string; body: string | null }
): Promise<boolean> {
	if (!ai) return false;

	const enabled = await db
		.prepare('SELECT ai_summaries FROM mail_automations WHERE user_id = ?')
		.bind(userId)
		.first<{ ai_summaries: number }>();
	if (enabled?.ai_summaries !== 1) return false;

	const existing = await db
		.prepare(
			`SELECT source_latest_id FROM thread_summaries WHERE user_id = ? AND thread_id = ?`
		)
		.bind(userId, thread.threadId)
		.first<{ source_latest_id: string }>();
	if (existing?.source_latest_id === thread.latestId) return false;

	const summary = await generateSummary(ai, {
		thread_id: thread.threadId,
		latest_id: thread.latestId,
		from_addr: thread.from,
		subject: thread.subject,
		body_head: thread.body
	});
	if (!summary) return false;

	await saveThreadSummary(db, userId, {
		thread_id: thread.threadId,
		summary,
		source_latest_id: thread.latestId
	});
	return true;
}

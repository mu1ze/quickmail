import Anthropic from '@anthropic-ai/sdk';
import type { D1Database } from '@cloudflare/workers-types';
import { extractAiText } from './mail-classify';
import { htmlToPreviewText } from '$lib/utils/message-preview';

export const SUMMARY_BATCH = 20;
export const SUMMARY_MAX_CHARS = 220;
export const AI_SUMMARY_MODEL = '@cf/meta/llama-3.2-3b-instruct';
/** Claude Haiku 5.5 through OpenRouter, for threads too long for the Workers AI model. */
export const LONG_SUMMARY_MODEL = 'anthropic/claude-haiku-5.5';
/** The Workers AI prompt only fits this much body; longer threads go to Haiku. */
export const LONG_THREAD_CHARS = 1500;
/** How much of a long thread Haiku reads. */
export const LONG_SUMMARY_INPUT_CHARS = 12000;

const SUMMARY_PROMPT =
	'Summarize opened email for an inbox row. At most two short sentences. Plain text. No greeting.';

export type WorkersAiBinding = {
	run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
};

/** Returns the model's reply text, or null when it declined. */
export type LongSummarizer = (system: string, user: string) => Promise<string | null>;

/** Workers AI for short mail; Haiku for long threads when an OpenRouter key is set. */
export type SummaryModels = {
	ai?: WorkersAiBinding | null;
	summarizeLong?: LongSummarizer | null;
};

export function openRouterSummarizer(apiKey: string): LongSummarizer {
	// OpenRouter serves the Anthropic Messages API, authenticated with a bearer key.
	const client = new Anthropic({
		baseURL: 'https://openrouter.ai/api',
		apiKey: null,
		authToken: apiKey,
		maxRetries: 1,
		timeout: 20_000
	});
	return async (system, user) => {
		const message = await client.messages.create({
			model: LONG_SUMMARY_MODEL,
			max_tokens: 1024,
			system,
			messages: [{ role: 'user', content: user }]
		});
		if (message.stop_reason === 'refusal') return null;
		const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
		return text.trim() || null;
	};
}

export function summaryModels(env: { AI?: WorkersAiBinding; OPENROUTER_API_KEY?: string }): SummaryModels {
	const key = env.OPENROUTER_API_KEY?.trim();
	return { ai: env.AI ?? null, summarizeLong: key ? openRouterSummarizer(key) : null };
}

function hasSummaryModel(models: SummaryModels): boolean {
	return Boolean(models.ai || models.summarizeLong);
}

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

function bodyText(body: string | null): string {
	if (!body) return '';
	const text = /<[a-z][\s\S]*>/i.test(body) ? htmlToPreviewText(body) : body;
	return text.replace(/\s+/g, ' ').trim();
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

/** Long threads go to Haiku first; anything it can't do falls back to Workers AI. */
export async function summarizeThread(
	models: SummaryModels,
	thread: { from: string; subject: string; body: string | null }
): Promise<string | null> {
	const body = bodyText(thread.body);
	const prompt = (text: string) => `From: ${thread.from}\nSubject: ${thread.subject}\nBody: ${text}`;

	if (body.length > LONG_THREAD_CHARS && models.summarizeLong) {
		try {
			const summary = parseAiSummaryResponse(
				await models.summarizeLong(SUMMARY_PROMPT, prompt(body.slice(0, LONG_SUMMARY_INPUT_CHARS)))
			);
			if (summary) return summary;
		} catch (error) {
			const status = error instanceof Anthropic.APIError ? error.status : undefined;
			console.warn('long thread summary failed; using Workers AI', status ?? error);
		}
	}

	if (!models.ai) return null;
	try {
		const raw = await models.ai.run(AI_SUMMARY_MODEL, {
			messages: [
				{ role: 'system', content: SUMMARY_PROMPT },
				{ role: 'user', content: prompt(body.slice(0, LONG_THREAD_CHARS)) }
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
			        substr(COALESCE(NULLIF(trim(e.body_text), ''), e.body_html, ''), 1, ${LONG_SUMMARY_INPUT_CHARS}) AS body_head
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
	models: SummaryModels
): Promise<number> {
	const threads = await listOpenedThreadsNeedingSummary(db, userId);
	let written = 0;

	for (const thread of threads) {
		const summary = await summarizeThread(models, {
			from: thread.from_addr,
			subject: thread.subject,
			body: thread.body_head
		});
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
	models: SummaryModels,
	userId: string,
	thread: { threadId: string; latestId: string; from: string; subject: string; body: string | null }
): Promise<boolean> {
	if (!hasSummaryModel(models)) return false;

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

	const summary = await summarizeThread(models, thread);
	if (!summary) return false;

	await saveThreadSummary(db, userId, {
		thread_id: thread.threadId,
		summary,
		source_latest_id: thread.latestId
	});
	return true;
}

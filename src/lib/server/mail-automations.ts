import type { D1Database } from '@cloudflare/workers-types';
import { listUsers } from './auth';
import {
	classifyBodyText,
	classifyOpenedMail,
	MAX_AUTOMATION_RULES,
	parseAiClassifyResponse,
	parseAutomationRules,
	type AutomationRule,
	type ClassifyDecision,
	type ClassifyInput
} from './mail-classify';
import { backfillThreadSummaries, type WorkersAiBinding } from './mail-summaries';

export const CLEANUP_BATCH = 100;
export const WEEKLY_CRON = '0 8 * * 0';
export const AI_CLASSIFY_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export class MailAutomationsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MailAutomationsError';
	}
}

export type MailAutomationsSettings = {
	weeklyCleanup: boolean;
	aiClassify: boolean;
	aiSummaries: boolean;
	rules: AutomationRule[];
	lastCleanupAt: string | null;
	lastCleanupTrashed: number;
};

export type MailAutomationsView = MailAutomationsSettings & {
	aiAvailable: boolean;
};

type StoredRow = {
	weekly_cleanup: number;
	ai_classify: number;
	ai_summaries: number;
	rules: string;
	last_cleanup_at: string | null;
	last_cleanup_trashed: number;
};

const EMPTY_SETTINGS: MailAutomationsSettings = {
	weeklyCleanup: false,
	aiClassify: false,
	aiSummaries: false,
	rules: [],
	lastCleanupAt: null,
	lastCleanupTrashed: 0
};

function mapRow(row: StoredRow | null): MailAutomationsSettings {
	if (!row) return { ...EMPTY_SETTINGS };
	return {
		weeklyCleanup: row.weekly_cleanup === 1,
		aiClassify: row.ai_classify === 1,
		aiSummaries: row.ai_summaries === 1,
		rules: parseAutomationRules(safeJson(row.rules)) ?? [],
		lastCleanupAt: row.last_cleanup_at,
		lastCleanupTrashed: row.last_cleanup_trashed ?? 0
	};
}

function safeJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return [];
	}
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === 'boolean') return value;
	if (value === 0 || value === 1) return value === 1;
	return fallback;
}

export async function loadMailAutomations(db: D1Database, userId: string): Promise<MailAutomationsSettings> {
	const row = await db
		.prepare(
			`SELECT weekly_cleanup, ai_classify, ai_summaries, rules, last_cleanup_at, last_cleanup_trashed
			 FROM mail_automations WHERE user_id = ?`
		)
		.bind(userId)
		.first<StoredRow>();

	return mapRow(row);
}

export function viewMailAutomations(
	settings: MailAutomationsSettings,
	aiAvailable: boolean
): MailAutomationsView {
	return { ...settings, aiAvailable };
}

export async function saveMailAutomations(
	db: D1Database,
	userId: string,
	input: {
		weeklyCleanup?: unknown;
		aiClassify?: unknown;
		aiSummaries?: unknown;
		rules?: unknown;
	}
): Promise<MailAutomationsSettings> {
	const current = await loadMailAutomations(db, userId);
	const weeklyCleanup = asBoolean(input.weeklyCleanup, current.weeklyCleanup);
	const aiClassify = asBoolean(input.aiClassify, current.aiClassify);
	const aiSummaries = asBoolean(input.aiSummaries, current.aiSummaries);

	let rules = current.rules;
	if (input.rules !== undefined) {
		const parsed = parseAutomationRules(input.rules);
		if (!parsed) {
			throw new MailAutomationsError(
				`Rules must be at most ${MAX_AUTOMATION_RULES} items with from/domain/subject and keep/trash.`
			);
		}
		rules = parsed;
	}

	await db
		.prepare(
			`INSERT INTO mail_automations (
				user_id, weekly_cleanup, ai_classify, ai_summaries, rules, last_cleanup_at, last_cleanup_trashed, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id) DO UPDATE SET
				weekly_cleanup = excluded.weekly_cleanup,
				ai_classify = excluded.ai_classify,
				ai_summaries = excluded.ai_summaries,
				rules = excluded.rules,
				updated_at = datetime('now')`
		)
		.bind(
			userId,
			weeklyCleanup ? 1 : 0,
			aiClassify ? 1 : 0,
			aiSummaries ? 1 : 0,
			JSON.stringify(rules),
			current.lastCleanupAt,
			current.lastCleanupTrashed
		)
		.run();

	return { ...current, weeklyCleanup, aiClassify, aiSummaries, rules };
}

type CleanupCandidate = {
	id: string;
	thread_id: string | null;
	from_addr: string;
	subject: string;
	body_head: string | null;
};

export type CleanupResult = {
	scanned: number;
	trashed: number;
};

export type WeeklyAutomationsResult = {
	users: number;
	scanned: number;
	trashed: number;
	summarized: number;
};

function classifyPrompt(input: ClassifyInput): string {
	return [
		'Classify an email the user has already opened. Reply with JSON only.',
		'{"action":"keep"} or {"action":"trash","reason":"short"}',
		'Trash only promotions, newsletters, marketing, and bulk updates.',
		'Keep personal mail, receipts, security, shipping, and anything uncertain.',
		`From: ${input.from}`,
		`Subject: ${input.subject}`,
		`Body: ${classifyBodyText(input.body)}`
	].join('\n');
}

export async function classifyWithWorkersAi(
	ai: WorkersAiBinding,
	input: ClassifyInput
): Promise<ClassifyDecision | null> {
	try {
		const raw = await ai.run(AI_CLASSIFY_MODEL, {
			messages: [
				{
					role: 'system',
					content: 'You classify opened email. JSON only. Prefer keep when unsure.'
				},
				{ role: 'user', content: classifyPrompt(input) }
			],
			max_tokens: 80
		});
		const parsed = parseAiClassifyResponse(raw);
		return parsed?.action === 'trash' ? parsed : null;
	} catch {
		return null;
	}
}

/** Candidates: inbound, already read, not starred/pinned/trashed/snoozed. Never unread. */
export async function listCleanupCandidates(
	db: D1Database,
	userId: string,
	limit = CLEANUP_BATCH
): Promise<CleanupCandidate[]> {
	const { results } = await db
		.prepare(
			`SELECT id, thread_id, from_addr, subject,
			        substr(COALESCE(NULLIF(trim(body_text), ''), body_html, ''), 1, 4000) AS body_head
			 FROM emails
			 WHERE user_id = ?
			   AND direction = 'inbound'
			   AND is_read = 1
			   AND is_starred = 0
			   AND is_pinned = 0
			   AND deleted_at IS NULL
			   AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))
			   AND (status IS NULL OR status <> 'draft')
			 ORDER BY datetime(created_at) ASC
			 LIMIT ?`
		)
		.bind(userId, limit)
		.all<CleanupCandidate>();

	return results;
}

async function autoTrashEmail(
	db: D1Database,
	userId: string,
	id: string,
	reason: string
): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE emails
			 SET deleted_at = datetime('now'),
			     auto_trashed_at = datetime('now'),
			     auto_trash_reason = ?,
			     snoozed_until = NULL
			 WHERE user_id = ?
			   AND id = ?
			   AND direction = 'inbound'
			   AND is_read = 1
			   AND is_starred = 0
			   AND is_pinned = 0
			   AND deleted_at IS NULL`
		)
		.bind(reason.slice(0, 160), userId, id)
		.run();

	return (result.meta?.changes ?? 0) > 0;
}

async function recordCleanup(db: D1Database, userId: string, trashed: number): Promise<void> {
	await db
		.prepare(
			`INSERT INTO mail_automations (
				user_id, weekly_cleanup, ai_classify, ai_summaries, rules, last_cleanup_at, last_cleanup_trashed, updated_at
			) VALUES (?, 1, 0, 0, '[]', datetime('now'), ?, datetime('now'))
			 ON CONFLICT(user_id) DO UPDATE SET
				last_cleanup_at = datetime('now'),
				last_cleanup_trashed = excluded.last_cleanup_trashed,
				updated_at = datetime('now')`
		)
		.bind(userId, trashed)
		.run();
}

export async function runUserCleanup(
	db: D1Database,
	userId: string,
	settings: MailAutomationsSettings,
	ai?: WorkersAiBinding | null
): Promise<CleanupResult> {
	const candidates = await listCleanupCandidates(db, userId);
	let trashed = 0;
	const useAi = Boolean(settings.aiClassify && ai);

	for (const row of candidates) {
		const input: ClassifyInput = {
			from: row.from_addr,
			subject: row.subject,
			body: row.body_head
		};
		const decision = await classifyOpenedMail(input, {
			rules: settings.rules,
			classifyWithAi: useAi && ai ? (mail) => classifyWithWorkersAi(ai, mail) : undefined
		});
		if (decision.action !== 'trash') continue;
		if (await autoTrashEmail(db, userId, row.id, decision.reason)) {
			trashed += 1;
		}
	}

	await recordCleanup(db, userId, trashed);
	return { scanned: candidates.length, trashed };
}

export async function runUserAutomations(
	db: D1Database,
	userId: string,
	ai?: WorkersAiBinding | null
): Promise<{ scanned: number; trashed: number; summarized: number }> {
	const settings = await loadMailAutomations(db, userId);
	let scanned = 0;
	let trashed = 0;
	let summarized = 0;

	if (settings.weeklyCleanup) {
		const cleanup = await runUserCleanup(db, userId, settings, ai);
		scanned = cleanup.scanned;
		trashed = cleanup.trashed;
	}

	if (settings.aiSummaries && ai) {
		summarized = await backfillThreadSummaries(db, userId, ai);
	}

	return { scanned, trashed, summarized };
}

/**
 * Weekly cron: every inbound message still lands in the inbox. This pass only
 * looks at mail the user has already opened, then moves the unimportant ones
 * to Trash (recoverable). Summaries are generated the same way when enabled.
 */
export async function runWeeklyMailAutomations(env: {
	DB: D1Database;
	AI?: WorkersAiBinding;
}): Promise<WeeklyAutomationsResult> {
	const users = await listUsers(env.DB);
	const totals: WeeklyAutomationsResult = { users: 0, scanned: 0, trashed: 0, summarized: 0 };

	for (const user of users) {
		try {
			const settings = await loadMailAutomations(env.DB, user.id);
			if (!settings.weeklyCleanup && !settings.aiSummaries) continue;
			totals.users += 1;
			const result = await runUserAutomations(env.DB, user.id, env.AI);
			totals.scanned += result.scanned;
			totals.trashed += result.trashed;
			totals.summarized += result.summarized;
		} catch (error) {
			console.error('mail automations failed for user', user.id, error);
		}
	}

	return totals;
}

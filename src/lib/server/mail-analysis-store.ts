import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { ANALYSIS_VERSION, isMailCategory, type MailAnalysis, type MailCategory } from '$lib/mail-analysis';
import type { AnalysisMetadata } from './subq';

/** Append these to the same D1 batch as the inbound email insert. */
export function analysisInsertStatements(db: D1Database, id: string, userId: string, metadata: AnalysisMetadata = {}): D1PreparedStatement[] {
	return [
		db.prepare('INSERT INTO email_analysis_metadata(email_id,user_id,metadata_json) VALUES(?,?,?)').bind(id, userId, JSON.stringify(metadata)),
		db.prepare(`INSERT INTO email_analysis_jobs(email_id,user_id,version)
			SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM mail_analysis_settings WHERE user_id=? AND enabled=1)`)
			.bind(id, userId, ANALYSIS_VERSION, userId)
	];
}
export async function analysisEnabled(db: D1Database, userId: string): Promise<boolean> {
	return (await db.prepare('SELECT enabled FROM mail_analysis_settings WHERE user_id=?').bind(userId).first<{ enabled: number }>())?.enabled === 1;
}
export async function setAnalysisEnabled(db: D1Database, userId: string, enabled: boolean) {
	await db.batch([
		db.prepare(`INSERT INTO mail_analysis_settings(user_id,enabled) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
			backfill_all=CASE WHEN excluded.enabled=0 THEN 0 ELSE backfill_all END,updated_at=datetime('now')`).bind(userId, enabled ? 1 : 0),
		// Cancel pending work and invalidate processing leases immediately on opt-out.
		...(enabled ? [] : [db.prepare('DELETE FROM email_analysis_jobs WHERE user_id=?').bind(userId)])
	]);
}
export async function enqueueAnalysisBackfill(db: D1Database, userId: string, limit = 200): Promise<number> {
	const result = await db.prepare(`INSERT OR IGNORE INTO email_analysis_jobs(email_id,user_id,version)
		SELECT e.id,e.user_id,? FROM emails e WHERE e.user_id=? AND e.direction='inbound' AND e.deleted_at IS NULL
		AND EXISTS(SELECT 1 FROM mail_analysis_settings s WHERE s.user_id=e.user_id AND s.enabled=1)
		AND NOT EXISTS(SELECT 1 FROM email_analysis a WHERE a.email_id=e.id AND a.user_id=e.user_id AND a.version=?)
		AND NOT EXISTS(SELECT 1 FROM email_analysis_jobs j WHERE j.email_id=e.id AND j.user_id=e.user_id AND j.version=?)
		ORDER BY datetime(e.created_at) DESC,e.id DESC LIMIT ?`).bind(ANALYSIS_VERSION, userId, ANALYSIS_VERSION, ANALYSIS_VERSION, Math.min(200, Math.max(1, limit))).run();
	return result.meta.changes;
}

/** Inbound mail that has neither an analysis nor a job for the current version. */
export async function countUnanalyzed(db: D1Database, userId: string): Promise<number> {
	const row = await db.prepare(`SELECT COUNT(*) AS n FROM emails e WHERE e.user_id=? AND e.direction='inbound' AND e.deleted_at IS NULL
		AND NOT EXISTS(SELECT 1 FROM email_analysis a WHERE a.email_id=e.id AND a.user_id=e.user_id AND a.version=?)
		AND NOT EXISTS(SELECT 1 FROM email_analysis_jobs j WHERE j.email_id=e.id AND j.user_id=e.user_id AND j.version=?)`)
		.bind(userId, ANALYSIS_VERSION, ANALYSIS_VERSION).first<{ n: number }>();
	return row?.n ?? 0;
}
/** Status of eligible mail, based on saved results rather than job completion alone. */
export async function analysisProgress(db: D1Database, userId: string) {
	const { results } = await db.prepare(`SELECT CASE
		WHEN a.email_id IS NOT NULL THEN 'analyzed'
		WHEN j.email_id IS NULL THEN 'unqueued'
		WHEN j.status='analyzed' THEN 'pending'
		ELSE j.status END AS status, COUNT(*) AS count
		FROM emails e
		LEFT JOIN email_analysis a ON a.email_id=e.id AND a.user_id=e.user_id AND a.version=?
		LEFT JOIN email_analysis_jobs j ON j.email_id=e.id AND j.user_id=e.user_id AND j.version=?
		WHERE e.user_id=? AND e.direction='inbound' AND e.deleted_at IS NULL
		GROUP BY 1`).bind(ANALYSIS_VERSION, ANALYSIS_VERSION, userId).all<{ status: string; count: number }>();
	return results;
}
export async function backfillAllActive(db: D1Database, userId: string): Promise<boolean> {
	return (await db.prepare('SELECT backfill_all FROM mail_analysis_settings WHERE user_id=? AND enabled=1').bind(userId).first<{ backfill_all: number }>())?.backfill_all === 1;
}
export async function setBackfillAll(db: D1Database, userId: string, on: boolean) {
	await db.prepare("UPDATE mail_analysis_settings SET backfill_all=?,updated_at=datetime('now') WHERE user_id=? AND enabled=1").bind(on ? 1 : 0, userId).run();
}
/**
 * One step of "analyze everything": queue the next batch once the previous one
 * has mostly drained, and clear the flag when nothing is left to queue.
 * Returns how many jobs were added.
 */
export async function continueBackfill(db: D1Database, userId: string, batch = 200): Promise<number> {
	if (!await backfillAllActive(db, userId)) return 0;
	const open = await db.prepare("SELECT COUNT(*) AS n FROM email_analysis_jobs WHERE user_id=? AND version=? AND status IN ('pending','processing')")
		.bind(userId, ANALYSIS_VERSION).first<{ n: number }>();
	if ((open?.n ?? 0) >= 20) return 0;
	const added = await enqueueAnalysisBackfill(db, userId, batch);
	if (added === 0 && (open?.n ?? 0) === 0 && await countUnanalyzed(db, userId) === 0) await setBackfillAll(db, userId, false);
	return added;
}

type AnalysisRow = {
	id: string; status: 'pending' | 'processing' | 'analyzed' | 'failed' | null;
	category: string | null; predicted_category: string | null; correction_category: string | null; confidence: number | null;
	review: number | null; phishing: number | null; spam: number | null;
	needs_reply: number | null; deadline: number | null; urgency: number | null;
	warning_dismissed: number | null; task_done: number | null; replied: number;
};
export async function loadMailAnalyses(db: D1Database, userId: string, ids: string[]): Promise<Map<string, MailAnalysis>> {
	const result = new Map<string, MailAnalysis>();
	if (ids.length > 80) {
		for (let i=0;i<ids.length;i+=80) for (const [id,a] of await loadMailAnalyses(db,userId,ids.slice(i,i+80))) result.set(id,a);
		return result;
	}
	if (!ids.length) return result;
	const { results } = await db.prepare(`SELECT e.id,j.status,a.category,a.predicted_category,a.confidence,a.review,a.phishing,a.spam,a.needs_reply,a.deadline,a.urgency,
		c.category AS correction_category,c.warning_dismissed,c.task_done,
		EXISTS(SELECT 1 FROM emails sent WHERE sent.user_id=e.user_id AND sent.direction='outbound'
			AND sent.reply_to_email_id=e.id AND sent.status IN ('sent','delivered','delayed')) AS replied
		FROM emails e LEFT JOIN email_analysis a ON a.email_id=e.id AND a.user_id=e.user_id AND a.version=?
		LEFT JOIN email_analysis_corrections c ON c.email_id=e.id AND c.user_id=e.user_id
		LEFT JOIN email_analysis_jobs j ON j.email_id=e.id AND j.user_id=e.user_id AND j.version=?
		WHERE e.user_id=? AND e.direction='inbound' AND e.id IN (${ids.map(() => '?').join(',')})`)
		.bind(ANALYSIS_VERSION, ANALYSIS_VERSION, userId, ...ids).all<AnalysisRow>();
	for (const row of results) {
		if (row.confidence === null && !row.status && !row.correction_category) continue;
		const corrected = isMailCategory(row.correction_category);
		const confident = isMailCategory(row.category) ? row.category : null;
		// Below the confidence bar the model's best guess still files the mail under a tab, flagged for review.
		// Possible phishing or spam is never filed by a guess.
		const guess = !corrected && !confident && row.phishing !== 1 && row.spam !== 1 && isMailCategory(row.predicted_category) ? row.predicted_category : null;
		const category = corrected ? row.correction_category as MailCategory : confident ?? guess;
		const phishing = row.phishing === 1 && row.warning_dismissed !== 1;
		const spam = row.spam === 1 && row.warning_dismissed !== 1;
		result.set(row.id, {
			emailId: row.id, status: row.confidence !== null ? 'analyzed' : row.status === 'failed' ? 'failed' : 'pending',
			category, suggested: guess !== null, corrected, confidence: row.confidence,
			review: phishing || spam || (!corrected && row.confidence !== null && !confident) || row.status === 'failed',
			phishing, spam, needsReply: row.needs_reply === 1 && !row.task_done && !row.replied && !phishing && !spam,
			deadline: row.deadline === 1 && !row.task_done && !phishing && !spam,
			urgency: row.urgency
		});
	}
	return result;
}
export async function correctMailAnalysis(db: D1Database, userId: string, emailId: string, input: { category?: MailCategory | null; warningDismissed?: boolean; taskDone?: boolean }): Promise<boolean> {
	const owned = await db.prepare("SELECT id FROM emails WHERE id=? AND user_id=? AND direction='inbound'").bind(emailId, userId).first();
	if (!owned) return false;
	const assignments: string[] = [], bindings: unknown[] = [];
	if (input.category !== undefined) { assignments.push('category=?'); bindings.push(input.category); }
	if (input.warningDismissed !== undefined) { assignments.push('warning_dismissed=?'); bindings.push(Number(input.warningDismissed)); }
	if (input.taskDone !== undefined) { assignments.push('task_done=?'); bindings.push(Number(input.taskDone)); }
	if (!assignments.length) return false;
	await db.batch([
		db.prepare(`INSERT OR IGNORE INTO email_analysis_corrections(email_id,user_id) SELECT id,user_id FROM emails WHERE id=? AND user_id=?`).bind(emailId,userId),
		db.prepare(`UPDATE email_analysis_corrections SET ${assignments.join(',')},updated_at=datetime('now') WHERE email_id=? AND user_id=?`).bind(...bindings,emailId,userId)
	]);
	return true;
}

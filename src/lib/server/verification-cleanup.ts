import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { matchAutomationRules, parseAutomationRules } from './mail-classify';

const BATCH_SIZE = 100;

/** Consume arrival deadlines, not whole threads. Runs without a browser open. */
export async function trashExpiredVerificationEmails(db: D1Database, now = new Date()): Promise<number> {
	const cutoff = now.toISOString().slice(0, 19).replace('T', ' ');
	const { results: due } = await db.prepare(`
		SELECT e.id, e.user_id, e.from_addr, e.subject, a.rules
		FROM emails e LEFT JOIN mail_automations a ON a.user_id = e.user_id
		WHERE e.code_cleanup_at IS NOT NULL AND e.code_cleanup_at <= ?
		ORDER BY e.code_cleanup_at, e.rowid LIMIT ?
	`).bind(cutoff, BATCH_SIZE).all<{ id: string; user_id: string; from_addr: string; subject: string; rules: string | null }>();
	if (!due.length) return 0;
	const statements: D1PreparedStatement[] = [];
	const trashIndexes: number[] = [];
	for (const email of due) {
		// Existing Never auto-trash rules apply to code cleanup too.
		let rules;
		try { rules = parseAutomationRules(JSON.parse(email.rules ?? '[]')); }
		catch { rules = null; }
		const keep = !rules || matchAutomationRules({ from: email.from_addr, subject: email.subject, body: null }, rules)?.source === 'keep_rule';
		if (!keep) {
			trashIndexes.push(statements.length);
			statements.push(db.prepare(`
				UPDATE emails SET deleted_at = ?, auto_trashed_at = ?,
					auto_trash_reason = 'One-time code: five-minute cleanup', snoozed_until = NULL,
					code_cleanup_at = NULL
				WHERE id = ? AND user_id = ? AND code_cleanup_at <= ?
					AND direction = 'inbound' AND deleted_at IS NULL
					AND is_starred = 0 AND is_pinned = 0 AND is_archived = 0 AND is_spam = 0
					AND snoozed_until IS NULL AND (status IS NULL OR status <> 'draft')
					AND NOT EXISTS (SELECT 1 FROM emails kept WHERE kept.user_id = emails.user_id
						AND COALESCE(kept.thread_id, kept.id) = COALESCE(emails.thread_id, emails.id)
						AND kept.deleted_at IS NULL AND (kept.is_starred = 1 OR kept.is_pinned = 1))
					AND EXISTS (SELECT 1 FROM mail_automations a WHERE a.user_id = emails.user_id
						AND a.code_cleanup = 1 AND a.rules = ?)
			`).bind(cutoff, cutoff, email.id, email.user_id, cutoff, email.rules));
		}
		// Consume protected/disabled deadlines too; restoring never reschedules.
		statements.push(db.prepare('UPDATE emails SET code_cleanup_at = NULL WHERE id = ? AND user_id = ? AND code_cleanup_at <= ?')
			.bind(email.id, email.user_id, cutoff));
	}
	const results = await db.batch(statements);
	return trashIndexes.reduce((count, index) => count + (results[index].meta.changes ?? 0), 0);
}

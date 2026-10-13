import type { D1Database } from '@cloudflare/workers-types';
import type { MailLabel } from '$lib/types';
import { expandToThreads } from './mail-store';

export async function listMailLabels(db: D1Database, userId: string): Promise<MailLabel[]> {
	const { results } = await db.prepare('SELECT id, name FROM mail_labels WHERE user_id = ? ORDER BY name COLLATE NOCASE').bind(userId).all<MailLabel>();
	return results;
}

export async function loadThreadLabels(db: D1Database, userId: string, threadIds: string[]): Promise<Map<string, MailLabel[]>> {
	const map = new Map<string, MailLabel[]>();
	if (!threadIds.length) return map;
	const { results } = await db.prepare(`SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id, l.id, l.name
		FROM email_labels el JOIN emails e ON e.id = el.email_id JOIN mail_labels l ON l.id = el.label_id
		WHERE e.user_id = ? AND l.user_id = ? AND COALESCE(e.thread_id, e.id) IN (${threadIds.map(() => '?').join(',')}) ORDER BY l.name COLLATE NOCASE`)
		.bind(userId, userId, ...threadIds).all<MailLabel & { thread_id: string }>();
	for (const row of results) {
		const labels = map.get(row.thread_id) ?? [];
		labels.push({ id: row.id, name: row.name }); map.set(row.thread_id, labels);
	}
	return map;
}

/** Check ownership before constructing an atomic batch. Labels apply to conversations. */
export async function applyMailLabels(db: D1Database, userId: string, selected: string[], changes: { labelId: string; apply: boolean }[]): Promise<boolean> {
	const owned = new Set((await listMailLabels(db, userId)).map((label) => label.id));
	if (changes.some((change) => !owned.has(change.labelId))) return false;
	const ids = await expandToThreads(db, userId, selected);
	if (!ids.length) return false;
	const scope = `SELECT e.id FROM emails e WHERE e.user_id = ? AND COALESCE(e.thread_id, e.id) IN
		(SELECT COALESCE(thread_id, id) FROM emails WHERE user_id = ? AND id IN (${selected.map(() => '?').join(',')}))`;
	const statements = changes.map((change) => change.apply
		? db.prepare(`INSERT OR IGNORE INTO email_labels(email_id, label_id) SELECT id, ? FROM (${scope})`).bind(change.labelId, userId, userId, ...selected)
		: db.prepare(`DELETE FROM email_labels WHERE label_id = ? AND email_id IN (${scope})`).bind(change.labelId, userId, userId, ...selected));
	if (statements.length) await db.batch(statements);
	return true;
}

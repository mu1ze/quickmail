import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_NOTIFICATION_PREFS, sanitizeNotificationPrefs, type NotificationPrefs } from '$lib/notification-rules';

/** Defaults when nothing is saved yet, or before migration 0029 has run. */
export async function loadNotificationPrefs(db: D1Database, userId: string): Promise<NotificationPrefs> {
	try {
		const row = await db
			.prepare('SELECT prefs_json FROM notification_preferences WHERE user_id = ?')
			.bind(userId)
			.first<{ prefs_json: string }>();
		return row ? sanitizeNotificationPrefs(JSON.parse(row.prefs_json)) : { ...DEFAULT_NOTIFICATION_PREFS };
	} catch {
		return { ...DEFAULT_NOTIFICATION_PREFS };
	}
}

export async function saveNotificationPrefs(db: D1Database, userId: string, input: unknown): Promise<NotificationPrefs> {
	const prefs = sanitizeNotificationPrefs(input);
	await db
		.prepare(
			`INSERT INTO notification_preferences (user_id, prefs_json) VALUES (?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime('now')`
		)
		.bind(userId, JSON.stringify(prefs))
		.run();
	return prefs;
}

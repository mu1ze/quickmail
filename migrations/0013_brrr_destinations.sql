-- User-owned Brrr phone webhooks. One destination per account; replace on save.
-- sender_sounds is a JSON array of { sender, sound } rules for per-from alerts.

CREATE TABLE brrr_destinations (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	webhook_key TEXT NOT NULL,
	default_sound TEXT NOT NULL DEFAULT 'default',
	sender_sounds TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

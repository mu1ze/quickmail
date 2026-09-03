-- Per-user mailbox automations. Cleanup is opt-in and only ever runs against
-- mail the user has already opened; inbound delivery is unchanged.
CREATE TABLE mail_automations (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	weekly_cleanup INTEGER NOT NULL DEFAULT 0,
	ai_classify INTEGER NOT NULL DEFAULT 0,
	ai_summaries INTEGER NOT NULL DEFAULT 0,
	rules TEXT NOT NULL DEFAULT '[]',
	last_cleanup_at TEXT,
	last_cleanup_trashed INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE emails ADD COLUMN auto_trashed_at TEXT;
ALTER TABLE emails ADD COLUMN auto_trash_reason TEXT;

CREATE INDEX idx_emails_cleanup ON emails(user_id, direction, is_read, deleted_at);

CREATE TABLE thread_summaries (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	thread_id TEXT NOT NULL,
	summary TEXT NOT NULL,
	source_latest_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, thread_id)
);

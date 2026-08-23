-- Named signature library (up to five per user). Mailboxes can pin one as their
-- default; the composer can switch for a single message.
CREATE TABLE signatures (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	is_default INTEGER NOT NULL DEFAULT 0,
	position INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_signatures_user ON signatures(user_id);

ALTER TABLE addresses ADD COLUMN signature_id TEXT;

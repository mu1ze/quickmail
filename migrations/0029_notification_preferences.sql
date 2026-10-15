-- Which new mail notifies (all, people only, VIPs only), VIP senders, quiet hours, previews.
CREATE TABLE notification_preferences (
	user_id TEXT PRIMARY KEY,
	prefs_json TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

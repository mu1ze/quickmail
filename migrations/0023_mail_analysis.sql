-- Semantic analysis is separate from mailbox folder flags and weekly cleanup.
CREATE TABLE mail_analysis_settings (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE email_analysis_metadata (
	email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	metadata_json TEXT NOT NULL
);
CREATE TABLE email_analysis_jobs (
	email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	version TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','analyzed','failed')),
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER NOT NULL DEFAULT 0,
	queued_until INTEGER NOT NULL DEFAULT 0,
	lease_until INTEGER NOT NULL DEFAULT 0,
	lease_token TEXT,
	error_code TEXT,
	PRIMARY KEY(email_id, version)
);
CREATE INDEX idx_analysis_jobs_due ON email_analysis_jobs(status, next_attempt_at, lease_until);
CREATE TABLE email_analysis (
	email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	version TEXT NOT NULL,
	model TEXT NOT NULL,
	input_hash TEXT NOT NULL,
	category TEXT,
	predicted_category TEXT NOT NULL,
	confidence REAL NOT NULL,
	review INTEGER NOT NULL,
	phishing INTEGER NOT NULL,
	spam INTEGER NOT NULL,
	needs_reply INTEGER NOT NULL,
	deadline INTEGER NOT NULL,
	urgency REAL NOT NULL,
	answers_json TEXT NOT NULL,
	input_tokens INTEGER NOT NULL,
	analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_analysis_user_category ON email_analysis(user_id, category);
CREATE TABLE email_analysis_corrections (
	email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	category TEXT,
	warning_dismissed INTEGER NOT NULL DEFAULT 0,
	task_done INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE mail_analysis_provider_state (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	pause_until INTEGER NOT NULL DEFAULT 0,
	error_code TEXT
);

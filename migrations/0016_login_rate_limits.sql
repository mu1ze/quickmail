CREATE TABLE login_rate_limits (
	key_hash TEXT PRIMARY KEY,
	attempts INTEGER NOT NULL DEFAULT 0,
	window_started_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_login_rate_limits_updated ON login_rate_limits(updated_at);

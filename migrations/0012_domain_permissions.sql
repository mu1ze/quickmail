-- Per-user domain access. Missing row = full access (send, receive, create
-- addresses). Admins ignore this table. Operators store a row only when they
-- throttle a non-admin on a connected domain.
CREATE TABLE domain_permissions (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
	can_send INTEGER NOT NULL DEFAULT 1,
	can_receive INTEGER NOT NULL DEFAULT 1,
	can_create_address INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, domain_id)
);

CREATE INDEX idx_domain_permissions_domain ON domain_permissions(domain_id);

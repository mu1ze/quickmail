-- Hosted photos and logos for compiled email signatures. Recipients fetch these
-- from /s/:id, so the objects are intentionally public.

CREATE TABLE signature_assets (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	content_type TEXT NOT NULL,
	byte_size INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_signature_assets_user ON signature_assets(user_id);

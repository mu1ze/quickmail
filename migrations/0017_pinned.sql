ALTER TABLE emails ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_emails_pinned ON emails(user_id, is_pinned);

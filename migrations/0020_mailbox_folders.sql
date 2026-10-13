-- Archive keeps mail searchable; spam is separate from the inbox and All mail.
ALTER TABLE emails ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN is_spam INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_emails_user_folder ON emails(user_id, is_spam, is_archived, deleted_at);

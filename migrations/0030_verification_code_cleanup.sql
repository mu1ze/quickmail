-- Only new code mail received while this account opts in gets a deadline.
ALTER TABLE mail_automations ADD COLUMN code_cleanup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN code_cleanup_at TEXT;
CREATE INDEX idx_emails_code_cleanup ON emails(code_cleanup_at) WHERE code_cleanup_at IS NOT NULL;

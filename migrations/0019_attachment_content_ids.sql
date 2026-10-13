-- Preserve MIME references so embedded images can be served from R2.
ALTER TABLE email_attachments ADD COLUMN content_id TEXT;
ALTER TABLE email_attachments ADD COLUMN disposition TEXT;

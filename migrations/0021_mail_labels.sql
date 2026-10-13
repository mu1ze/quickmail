CREATE TABLE mail_labels (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL COLLATE NOCASE,
	UNIQUE(user_id, name)
);
CREATE TABLE email_labels (
	email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
	label_id TEXT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
	PRIMARY KEY(email_id, label_id)
);
CREATE INDEX idx_email_labels_label ON email_labels(label_id, email_id);

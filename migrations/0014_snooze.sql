-- Snooze hides a conversation from the inbox until a chosen time, then it
-- returns on its own. No cron: the inbox query treats a past timestamp as awake.

ALTER TABLE emails ADD COLUMN snoozed_until TEXT;

CREATE INDEX idx_emails_snoozed ON emails(user_id, snoozed_until);

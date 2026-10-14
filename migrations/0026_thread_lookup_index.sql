-- The mailbox queries match conversations with COALESCE(thread_id, id), which
-- the plain (user_id, thread_id) index cannot serve, so each conversation on a
-- page forced a scan of all of the user's mail. An index on the same
-- expression turns that into a direct lookup (query plan: user_id=? AND <expr>=?).
CREATE INDEX IF NOT EXISTS idx_emails_thread_coalesce ON emails(user_id, COALESCE(thread_id, id));

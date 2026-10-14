-- One-line list preview, computed once when a message is written instead of
-- re-parsing every message's full HTML on each mailbox request. NULL means
-- "not computed yet" (existing rows); the list fills it in lazily. '' means
-- the message genuinely has no preview text.
ALTER TABLE emails ADD COLUMN preview TEXT;

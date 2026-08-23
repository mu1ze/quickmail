-- One-time recovery migration after introducing versioned PBKDF2 hashes.
--
-- Temporary password for every account: TestPassword123.
-- Change every account password immediately after applying this migration.
-- The password is intentionally visible here so operators understand that it
-- is not suitable for continued use.

UPDATE users
SET password_hash = 'pbkdf2_sha256$600000$eKxXLigCZ1dJAGJw3qUZgA==$9RTjN3XW/DiwGu2O27WMorDVT2ew1QdwRVt/7nG8q1w=';

-- A password reset invalidates every existing authentication path. Users must
-- sign in with the temporary password and create fresh API keys afterward.
DELETE FROM sessions;
DELETE FROM api_tokens;
DELETE FROM login_rate_limits;

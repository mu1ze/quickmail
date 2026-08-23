-- One-time recovery after the PBKDF2 format/cost change locked operators out.
-- Every existing login is set to the temporary password TestPassword123.
-- Change each password in Settings immediately after signing in.
-- Fresh installs have no users, so this UPDATE is a no-op there.

UPDATE users
SET password_hash = 'pbkdf2_sha256$600000$dctywKy3RvjOyZo9AmqOZA==$3Gpyil1sdt/6sk8AbHI0AQBIc2Q030rhINAEPtDh5Nk=';

DELETE FROM sessions;
DELETE FROM api_tokens;
DELETE FROM login_rate_limits;

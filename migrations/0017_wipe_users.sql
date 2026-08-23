-- Start over: drop every login so /setup can create a new admin.
-- Related rows cascade (sessions, addresses, mail, tokens, signatures).

DELETE FROM users;
DELETE FROM login_rate_limits;

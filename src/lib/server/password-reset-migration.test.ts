import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { verifyPassword } from './crypto';

const migration = readFileSync(
	new URL('../../../migrations/0016_reset_existing_passwords.sql', import.meta.url),
	'utf8'
);

describe('existing-account password reset migration', () => {
	test('contains a valid current-format hash for the temporary password', async () => {
		const hash = migration.match(/SET password_hash = '([^']+)'/)?.[1];
		assert.ok(hash, 'migration password hash is missing');
		assert.equal(await verifyPassword('TestPassword123.', hash), true);
		assert.equal(await verifyPassword('TestPassword123', hash), false);
	});

	test('revokes sessions, API tokens, and rate-limit state', () => {
		assert.match(migration, /DELETE FROM sessions;/);
		assert.match(migration, /DELETE FROM api_tokens;/);
		assert.match(migration, /DELETE FROM login_rate_limits;/);
	});
});

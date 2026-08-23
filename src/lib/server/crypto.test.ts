import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPassword, verifyPassword } from './crypto';

describe('password hashing', () => {
	test('writes and verifies a salt:hash password', async () => {
		const hash = await hashPassword('a long test password');
		assert.match(hash, /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
		assert.equal(await verifyPassword('a long test password', hash), true);
		assert.equal(await verifyPassword('not the password', hash), false);
	});

	test('rejects malformed hashes', async () => {
		assert.equal(await verifyPassword('password', 'not-a-hash'), false);
	});
});

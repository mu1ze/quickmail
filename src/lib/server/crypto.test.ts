import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPassword, passwordNeedsRehash, PBKDF2_ITERATIONS, verifyPassword } from './crypto';

describe('password hashing', () => {
	test('writes a versioned current-cost hash', async () => {
		const hash = await hashPassword('a long test password');
		assert.match(hash, new RegExp(`^pbkdf2_sha256\\$${PBKDF2_ITERATIONS}\\$`));
		assert.equal(passwordNeedsRehash(hash), false);
		assert.equal(await verifyPassword('a long test password', hash), true);
		assert.equal(await verifyPassword('not the password', hash), false);
	});

	test('rejects malformed and unsupported hashes', async () => {
		assert.equal(await verifyPassword('password', 'not-a-hash'), false);
		assert.equal(await verifyPassword('password', 'unknown$1$YQ==$Yg=='), false);
		assert.equal(passwordNeedsRehash('legacy:hash'), true);
	});
});

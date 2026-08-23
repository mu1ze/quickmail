import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertPasswordLength, MIN_PASSWORD_LENGTH } from './auth';

describe('password length', () => {
	test('rejects short passwords', () => {
		assert.throws(() => assertPasswordLength('short'), /at least 8/);
		assert.equal(MIN_PASSWORD_LENGTH, 8);
	});

	test('accepts eight or more characters', () => {
		assert.doesNotThrow(() => assertPasswordLength('12345678'));
	});
});

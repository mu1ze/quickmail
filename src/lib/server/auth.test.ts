import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertPasswordLength, MIN_PASSWORD_LENGTH } from './auth';

describe('password length', () => {
	test('rejects short passwords', () => {
		assert.throws(() => assertPasswordLength('12345678901'), /at least 12/);
		assert.equal(MIN_PASSWORD_LENGTH, 12);
	});

	test('accepts twelve or more characters', () => {
		assert.doesNotThrow(() => assertPasswordLength('123456789012'));
	});
});

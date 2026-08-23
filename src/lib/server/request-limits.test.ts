import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	MAX_WEBHOOK_BODY_BYTES,
	utf8ByteLength,
	webhookBodyTooLarge
} from './request-limits';

describe('webhook request limits', () => {
	test('rejects invalid and oversized declared lengths', () => {
		assert.equal(webhookBodyTooLarge(null), false);
		assert.equal(webhookBodyTooLarge(String(MAX_WEBHOOK_BODY_BYTES)), false);
		assert.equal(webhookBodyTooLarge(String(MAX_WEBHOOK_BODY_BYTES + 1)), true);
		assert.equal(webhookBodyTooLarge('-1'), true);
		assert.equal(webhookBodyTooLarge('not-a-number'), true);
	});

	test('measures UTF-8 bytes rather than JavaScript code units', () => {
		assert.equal(utf8ByteLength('mail'), 4);
		assert.equal(utf8ByteLength('📧'), 4);
	});
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { requireOk, requestError } from './request';

describe('mailbox action responses', () => {
	test('rejects HTTP failures including non-JSON errors', async () => {
		await assert.rejects(() => requireOk(new Response('{"error":"Could not move message"}', { status: 403 })), /Could not move message/);
		await assert.rejects(() => requireOk(new Response('<h1>Unavailable</h1>', { status: 503 })), /503/);
		await assert.doesNotReject(() => requireOk(new Response(null, { status: 204 })));
	});
	test('gives a useful message for a lost connection', () => {
		assert.match(requestError(new TypeError('Failed to fetch')), /Check your connection/);
	});
});

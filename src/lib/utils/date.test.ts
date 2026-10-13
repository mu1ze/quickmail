import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatFullDate, formatRelativeDate } from './date';

describe('mail dates', () => {
	test('SQLite UTC timestamps and ISO timestamps describe the same instant', () => {
		const now = new Date('2026-10-13T10:15:00Z');
		assert.equal(formatRelativeDate('2026-10-13 10:00:00', now), '15m');
		assert.equal(formatRelativeDate('2026-10-13T10:00:00Z', now), '15m');
		assert.equal(formatFullDate('2026-10-13 10:00:00'), formatFullDate('2026-10-13T10:00:00Z'));
	});
	test('old mail includes the year and malformed dates remain unobtrusive', () => {
		assert.match(formatRelativeDate('2020-03-15 10:00:00', new Date('2026-10-13T10:15:00Z')), /2020/);
		assert.equal(formatRelativeDate('broken'), '');
		assert.equal(formatFullDate('broken'), '');
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatSnoozeUntil, resolveSnoozePreset, toSqliteDatetime } from './snooze';

describe('snooze presets', () => {
	test('tomorrow morning is 8:00 the next day', () => {
		const now = new Date(2026, 7, 23, 15, 30, 0);
		const at = resolveSnoozePreset('tomorrow', now);
		assert.ok(at);
		assert.equal(at.getDate(), 24);
		assert.equal(at.getHours(), 8);
		assert.equal(at.getMinutes(), 0);
	});

	test('Monday morning skips ahead when today is Monday', () => {
		const monday = new Date(2026, 7, 24, 9, 0, 0);
		const at = resolveSnoozePreset('monday', monday);
		assert.ok(at);
		assert.equal(at.getDay(), 1);
		assert.ok(at.getTime() > monday.getTime());
	});

	test('sqlite format is UTC without a timezone suffix', () => {
		const date = new Date(Date.UTC(2026, 7, 23, 18, 0, 0));
		assert.equal(toSqliteDatetime(date), '2026-08-23 18:00:00');
	});

	test('formatSnoozeUntil says Today for a time later today', () => {
		const now = new Date();
		const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
		assert.match(formatSnoozeUntil(toSqliteDatetime(later), now), /Today/);
	});
});

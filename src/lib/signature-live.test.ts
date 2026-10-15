import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	formatLiveTime,
	formatReturnDate,
	isValidTimeZone,
	liveStatusPath,
	parseLiveStatusQuery,
	pickLiveState,
	type LiveSchedule
} from './signature-live';

const weekdays: LiveSchedule = { tz: 'America/Toronto', start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5], oooFrom: '', oooTo: '' };
const ids = {
	available: '11111111-1111-4111-8111-111111111111',
	away: '22222222-2222-4222-8222-222222222222',
	ooo: '33333333-3333-4333-8333-333333333333'
};

describe('live signature availability', () => {
	test('working hours are read in the sender’s zone, not the server’s', () => {
		// Wed 2026-10-14 14:00 UTC is 10:00 in Toronto (EDT).
		assert.equal(pickLiveState(new Date('2026-10-14T14:00:00Z'), weekdays), 'available');
		// 22:00 UTC is 18:00 in Toronto, after hours.
		assert.equal(pickLiveState(new Date('2026-10-14T22:00:00Z'), weekdays), 'away');
		// Saturday morning in Toronto.
		assert.equal(pickLiveState(new Date('2026-10-17T14:00:00Z'), weekdays), 'away');
	});

	test('overnight hours wrap past midnight and belong to the day they started', () => {
		const nights: LiveSchedule = { ...weekdays, tz: 'UTC', start: 22 * 60, end: 6 * 60, days: [5] };
		assert.equal(pickLiveState(new Date('2026-10-16T23:00:00Z'), nights), 'available'); // Fri 23:00
		assert.equal(pickLiveState(new Date('2026-10-17T03:00:00Z'), nights), 'available'); // Sat 03:00, Friday's shift
		assert.equal(pickLiveState(new Date('2026-10-18T03:00:00Z'), nights), 'away'); // Sun 03:00
	});

	test('out of office wins over working hours for the whole range', () => {
		const away: LiveSchedule = { ...weekdays, oooFrom: '2026-10-14', oooTo: '2026-10-20' };
		assert.equal(pickLiveState(new Date('2026-10-14T14:00:00Z'), away), 'ooo');
		assert.equal(pickLiveState(new Date('2026-10-21T14:00:00Z'), away), 'available');
		assert.equal(pickLiveState(new Date('2026-10-14T14:00:00Z'), away, false), 'available');
	});

	test('the status URL round-trips and rejects tampering', () => {
		const schedule: LiveSchedule = { ...weekdays, oooFrom: '2026-12-24', oooTo: '2027-01-02' };
		const url = new URL(liveStatusPath(ids, schedule), 'https://mail.example');
		assert.deepEqual(parseLiveStatusQuery(url.searchParams), { ids, schedule });
		url.searchParams.set('tz', 'Not/AZone');
		assert.equal(parseLiveStatusQuery(url.searchParams), null);
		const bad = new URL(liveStatusPath(ids, weekdays), 'https://mail.example');
		bad.searchParams.set('a', '../../etc');
		assert.equal(parseLiveStatusQuery(bad.searchParams), null);
	});

	test('labels read naturally', () => {
		assert.equal(formatLiveTime(9 * 60), '9 AM');
		assert.equal(formatLiveTime(17 * 60 + 30), '5:30 PM');
		assert.equal(formatLiveTime(0), '12 AM');
		assert.equal(formatReturnDate('2026-10-31'), 'Nov 1');
		assert.equal(isValidTimeZone('Europe/Paris'), true);
		assert.equal(isValidTimeZone(''), false);
	});
});

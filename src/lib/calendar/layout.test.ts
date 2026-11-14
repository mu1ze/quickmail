import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { daysBetween, layoutLane, layoutTimedDay, occurrencesOnDay, readView, stepDate, viewRange, viewTitle } from './layout';
import type { CalendarOccurrence } from './types';

const TZ = 'America/Toronto';

function occ(id: string, start: string, end: string, allDay = false): CalendarOccurrence {
	return { id, eventId: id, calendarId: 'c', title: id, description: '', location: '', allDay, start, end, timeZone: TZ, rrule: null, occurrenceKey: null, seriesStart: start, seriesEnd: end, attendees: [], organizer: null, myStatus: null, reminders: [] };
}

describe('calendar layout', () => {
	test('view ranges, steps and titles', () => {
		assert.deepEqual(viewRange('week', '2026-11-14'), { from: '2026-11-08', to: '2026-11-15' });
		assert.deepEqual(viewRange('month', '2026-11-14'), { from: '2026-11-01', to: '2026-12-13' });
		assert.deepEqual(viewRange('day', '2026-11-14'), { from: '2026-11-14', to: '2026-11-15' });
		assert.equal(stepDate('month', '2026-01-31', 1), '2026-02-01');
		assert.equal(stepDate('week', '2026-11-14', -1), '2026-11-07');
		assert.equal(viewTitle('week', '2026-11-30'), 'Nov 29 – Dec 5, 2026');
		assert.equal(viewTitle('week', '2026-12-30'), 'Dec 27, 2026 – Jan 2, 2027');
		assert.equal(viewTitle('month', '2026-11-14'), 'November 2026');
		assert.equal(readView('nonsense'), 'week');
		assert.equal(daysBetween('2026-11-29', '2026-12-02').length, 3);
	});

	test('overlapping timed events share columns; separate clusters do not', () => {
		const blocks = layoutTimedDay([
			occ('a', '2026-11-16T14:00:00Z', '2026-11-16T15:00:00Z'),
			occ('b', '2026-11-16T14:30:00Z', '2026-11-16T15:30:00Z'),
			occ('c', '2026-11-16T15:00:00Z', '2026-11-16T16:00:00Z'),
			occ('d', '2026-11-16T18:00:00Z', '2026-11-16T19:00:00Z')
		], '2026-11-16', TZ);
		const by = Object.fromEntries(blocks.map((b) => [b.occurrence.id, b]));
		assert.equal(by.a.top, 540);
		assert.deepEqual([by.a.column, by.b.column, by.c.column], [0, 1, 0]);
		assert.equal(by.a.columns, 2);
		assert.equal(by.d.columns, 1);
	});

	test('overnight events split across days; midnight ends stay on the first day', () => {
		const overnight = occ('late', '2026-11-17T03:00:00Z', '2026-11-17T07:00:00Z'); // 22:00–02:00 local
		const first = layoutTimedDay([overnight], '2026-11-16', TZ)[0];
		const second = layoutTimedDay([overnight], '2026-11-17', TZ)[0];
		assert.deepEqual([first.top, first.bottom, first.continuesAfter], [1320, 1440, true]);
		assert.deepEqual([second.top, second.bottom, second.continuesBefore], [0, 120, true]);
		const toMidnight = occ('eve', '2026-11-17T03:00:00Z', '2026-11-17T05:00:00Z'); // 22:00–00:00
		assert.equal(layoutTimedDay([toMidnight], '2026-11-17', TZ).length, 0);
		assert.equal(layoutTimedDay([toMidnight], '2026-11-16', TZ)[0].continuesAfter, false);
	});

	test('all-day bars stack into rows within a week', () => {
		const days = daysBetween('2026-11-15', '2026-11-22');
		const bars = layoutLane([
			occ('trip', '2026-11-13', '2026-11-18', true),
			occ('conf', '2026-11-16', '2026-11-19', true),
			occ('off', '2026-11-20', '2026-11-21', true),
			occ('meeting', '2026-11-16T14:00:00Z', '2026-11-16T15:00:00Z')
		], days, TZ);
		const by = Object.fromEntries(bars.map((b) => [b.occurrence.id, b]));
		assert.equal(bars.length, 3);
		assert.deepEqual([by.trip.start, by.trip.span, by.trip.row, by.trip.continuesBefore], [0, 3, 0, true]);
		assert.deepEqual([by.conf.start, by.conf.row], [1, 1]);
		assert.deepEqual([by.off.start, by.off.row], [5, 0]);
		assert.deepEqual(occurrencesOnDay([by.trip.occurrence, by.off.occurrence], '2026-11-17', TZ).map((o) => o.id), ['trip']);
	});
});

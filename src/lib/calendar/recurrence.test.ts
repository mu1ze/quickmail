import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	describeRecurrence,
	expandSeries,
	formatRecurrence,
	lastOccurrence,
	parseRecurrence,
	presetFor,
	repeatPresets,
	retargetRecurrence,
	type SeriesSpec
} from './recurrence';
import { addMonths, startOfWeek, zonedParts, zonedToUtc } from './time';

const TZ = 'America/Toronto';

function window(from: string, to: string, tz = TZ) {
	return { fromMs: zonedToUtc(from, 0, tz), toMs: zonedToUtc(to, 0, tz), fromDate: from, toDate: to };
}

describe('calendar time', () => {
	test('wall times map to UTC across daylight saving', () => {
		assert.equal(new Date(zonedToUtc('2026-07-01', 9 * 60, TZ)).toISOString(), '2026-07-01T13:00:00.000Z');
		assert.equal(new Date(zonedToUtc('2026-12-01', 9 * 60, TZ)).toISOString(), '2026-12-01T14:00:00.000Z');
		// 2:30 does not exist on spring-forward day; it moves forward to 3:30 EDT.
		assert.equal(new Date(zonedToUtc('2026-03-08', 150, TZ)).toISOString(), '2026-03-08T07:30:00.000Z');
		// 1:30 happens twice on fall-back day; the first (EDT) reading wins.
		assert.equal(new Date(zonedToUtc('2026-11-01', 90, TZ)).toISOString(), '2026-11-01T05:30:00.000Z');
		assert.deepEqual(zonedParts(Date.parse('2026-11-14T04:30:00Z'), TZ).date, '2026-11-13');
	});

	test('date helpers clamp months and find week starts', () => {
		assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
		assert.equal(startOfWeek('2026-11-14'), '2026-11-08');
		assert.equal(startOfWeek('2026-11-14', 1), '2026-11-09');
	});
});

describe('recurrence rules', () => {
	test('parse and format round-trip the supported subset', () => {
		for (const rule of ['FREQ=DAILY', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10', 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20271231', 'FREQ=YEARLY']) {
			assert.equal(formatRecurrence(parseRecurrence(rule)!), rule);
		}
		assert.equal(formatRecurrence(parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=WE,MO;UNTIL=20261231T235959Z')!), 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231');
	});

	test('rejects rules it cannot honour', () => {
		for (const rule of ['', 'FREQ=HOURLY', 'FREQ=DAILY;BYHOUR=9', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;COUNT=2;UNTIL=20261231', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=MONTHLY;BYDAY=5MO', 'FREQ=DAILY;FREQ=WEEKLY', 'FREQ=DAILY;INTERVAL=1000']) {
			assert.equal(parseRecurrence(rule), null, rule);
		}
	});

	test('weekly meetings keep their local time across the DST change', () => {
		const spec: SeriesSpec = { rule: parseRecurrence('FREQ=WEEKLY')!, allDay: false, startDate: '2026-10-20', startMinutes: 9 * 60, duration: 3_600_000, timeZone: TZ };
		const found = expandSeries(spec, window('2026-10-01', '2026-11-30'));
		assert.deepEqual(found.map((o) => o.key), ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
		assert.ok(found.every((o) => zonedParts(o.startMs, TZ).minutes === 540));
	});

	test('weekly BYDAY, interval and count follow RFC 5545 week numbering', () => {
		const spec: SeriesSpec = { rule: parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=5')!, allDay: true, startDate: '2026-11-05', startMinutes: 0, duration: 1, timeZone: TZ };
		const found = expandSeries(spec, window('2026-11-01', '2027-01-31'));
		assert.deepEqual(found.map((o) => o.key), ['2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30', '2026-12-03']);
	});

	test('monthly rules skip months without the day and find nth weekdays', () => {
		const onThe31st: SeriesSpec = { rule: parseRecurrence('FREQ=MONTHLY;COUNT=4')!, allDay: true, startDate: '2026-01-31', startMinutes: 0, duration: 1, timeZone: TZ };
		assert.deepEqual(expandSeries(onThe31st, window('2026-01-01', '2027-01-01')).map((o) => o.key), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
		const lastFriday: SeriesSpec = { rule: parseRecurrence('FREQ=MONTHLY;BYDAY=-1FR')!, allDay: true, startDate: '2026-11-27', startMinutes: 0, duration: 1, timeZone: TZ };
		assert.deepEqual(expandSeries(lastFriday, window('2026-11-01', '2027-03-01')).map((o) => o.key), ['2026-11-27', '2026-12-25', '2027-01-29', '2027-02-26']);
	});

	test('yearly Feb 29 only lands on leap years', () => {
		const spec: SeriesSpec = { rule: parseRecurrence('FREQ=YEARLY')!, allDay: true, startDate: '2024-02-29', startMinutes: 0, duration: 1, timeZone: TZ };
		assert.deepEqual(expandSeries(spec, window('2024-01-01', '2033-01-01')).map((o) => o.key), ['2024-02-29', '2028-02-29', '2032-02-29']);
	});

	test('exdates, until and windows far from the start', () => {
		const spec: SeriesSpec = { rule: parseRecurrence('FREQ=DAILY;UNTIL=20261110')!, allDay: false, startDate: '2026-11-01', startMinutes: 600, duration: 1_800_000, timeZone: TZ, exdates: ['2026-11-05'] };
		assert.deepEqual(expandSeries(spec, window('2026-11-04', '2026-12-01')).map((o) => o.key), ['2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
		const old: SeriesSpec = { rule: parseRecurrence('FREQ=DAILY')!, allDay: false, startDate: '1990-01-01', startMinutes: 600, duration: 1_800_000, timeZone: TZ };
		assert.deepEqual(expandSeries(old, window('2026-11-14', '2026-11-16')).map((o) => o.key), ['2026-11-14', '2026-11-15']);
	});

	test('a multi-day occurrence that began before the window still shows', () => {
		const spec: SeriesSpec = { rule: parseRecurrence('FREQ=WEEKLY')!, allDay: true, startDate: '2026-11-06', startMinutes: 0, duration: 3, timeZone: TZ };
		assert.deepEqual(expandSeries(spec, window('2026-11-08', '2026-11-09')).map((o) => o.key), ['2026-11-06']);
	});

	test('last occurrence is found for COUNT and UNTIL, null when open-ended', () => {
		const base = { allDay: true, startDate: '2026-11-02', startMinutes: 0, duration: 1, timeZone: TZ };
		assert.equal(lastOccurrence({ ...base, rule: parseRecurrence('FREQ=WEEKLY;COUNT=3')! })?.key, '2026-11-16');
		assert.equal(lastOccurrence({ ...base, rule: parseRecurrence('FREQ=DAILY;UNTIL=20261105')! })?.endDate, '2026-11-06');
		assert.equal(lastOccurrence({ ...base, rule: parseRecurrence('FREQ=DAILY')! }), null);
	});

	test('descriptions and presets read naturally', () => {
		assert.equal(describeRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')!, '2026-11-16'), 'Every weekday');
		assert.equal(describeRecurrence(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6')!, '2026-11-16'), 'Every 2 weeks on Mon, Wed, 6 times');
		assert.equal(describeRecurrence(parseRecurrence('FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270630')!, '2026-11-27'), 'Monthly on the last Friday, until Jun 30, 2027');
		assert.equal(describeRecurrence(parseRecurrence('FREQ=YEARLY')!, '2026-11-14'), 'Annually on November 14');
		const presets = repeatPresets('2026-11-27');
		assert.ok(presets.some((p) => p.label === 'Monthly on the fourth Friday'));
		assert.equal(presetFor(parseRecurrence('FREQ=WEEKLY;BYDAY=FR')!, '2026-11-27'), 'weekly');
		assert.equal(presetFor(parseRecurrence('FREQ=WEEKLY;INTERVAL=3')!, '2026-11-27'), 'custom');
	});

	test('moving a series start keeps weekly and monthly rules on the new day', () => {
		assert.equal(formatRecurrence(retargetRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')!, '2026-11-16', '2026-11-17')), 'FREQ=WEEKLY;BYDAY=TU,TH');
		assert.equal(formatRecurrence(retargetRecurrence(parseRecurrence('FREQ=MONTHLY;BYDAY=2TU')!, '2026-11-10', '2026-11-26')), 'FREQ=MONTHLY;BYDAY=4TH');
	});
});

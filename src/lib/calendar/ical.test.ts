import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildICalendar, foldLine, importRecurrence, parseDuration, parseICalendar, resolveTimes, resolveZone } from './ical';
import { formatRecurrence } from './recurrence';

const GOOGLE_INVITE = [
	'BEGIN:VCALENDAR',
	'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
	'VERSION:2.0',
	'CALSCALE:GREGORIAN',
	'METHOD:REQUEST',
	'BEGIN:VTIMEZONE',
	'TZID:America/Toronto',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'DTSTART;TZID=America/Toronto:20261116T100000',
	'DTEND;TZID=America/Toronto:20261116T113000',
	'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261231T045959Z;BYDAY=MO',
	'EXDATE;TZID=America/Toronto:20261123T100000',
	'DTSTAMP:20261110T150000Z',
	'ORGANIZER;CN=Sam Lee:mailto:sam@example.com',
	'UID:abc123@google.com',
	'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=',
	' TRUE;CN=Pat;X-NUM-GUESTS=0:mailto:pat@quickmail.test',
	'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Lee, Sam":mailto:sam@example.com',
	'SEQUENCE:2',
	'SUMMARY:Design review\\, weekly',
	'DESCRIPTION:Agenda:\\nOne\\nTwo',
	'LOCATION:Room 4',
	'STATUS:CONFIRMED',
	'END:VEVENT',
	'END:VCALENDAR',
	''
].join('\r\n');

describe('iCalendar', () => {
	test('parses an invitation: unfolding, escapes, people, repeat and exceptions', () => {
		const calendar = parseICalendar(GOOGLE_INVITE);
		assert.equal(calendar.method, 'REQUEST');
		assert.equal(calendar.events.length, 1);
		const event = calendar.events[0];
		assert.equal(event.uid, 'abc123@google.com');
		assert.equal(event.sequence, 2);
		assert.equal(event.summary, 'Design review, weekly');
		assert.equal(event.description, 'Agenda:\nOne\nTwo');
		assert.deepEqual(event.organizer, { email: 'sam@example.com', name: 'Sam Lee', partstat: null, rsvp: false });
		assert.equal(event.attendees.length, 2);
		assert.equal(event.attendees[0].email, 'pat@quickmail.test');
		assert.equal(event.attendees[0].rsvp, true);
		assert.equal(event.attendees[1].name, 'Lee, Sam');
		assert.equal(event.attendees[1].partstat, 'ACCEPTED');

		const times = resolveTimes(event, 'UTC', calendar.zones);
		assert.deepEqual(times, { allDay: false, start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:30:00.000Z', timeZone: 'America/Toronto', startDate: '2026-11-16' });
		const rule = importRecurrence(event.rrule!, times);
		assert.ok(rule);
		// UNTIL 04:59Z on Dec 31 is still Dec 30 in Toronto; WKST is dropped.
		assert.equal(formatRecurrence(rule), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261230');
	});

	test('all-day events, durations and floating times', () => {
		const calendar = parseICalendar(
			['BEGIN:VCALENDAR', 'X-WR-TIMEZONE:Europe/Paris', 'BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Holiday', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:b', 'DTSTART:20261224T090000', 'DURATION:PT1H30M', 'END:VEVENT', 'END:VCALENDAR'].join('\n')
		);
		assert.equal(calendar.timeZone, 'Europe/Paris');
		assert.deepEqual(resolveTimes(calendar.events[0], 'Europe/Paris'), { allDay: true, start: '2026-12-24', end: '2026-12-25', timeZone: 'Europe/Paris', startDate: '2026-12-24' });
		const floating = resolveTimes(calendar.events[1], 'Europe/Paris');
		assert.equal(floating.start, '2026-12-24T08:00:00.000Z');
		assert.equal(floating.end, '2026-12-24T09:30:00.000Z');
		assert.equal(parseDuration('P1W'), 7 * 86_400_000);
		assert.equal(parseDuration('P2D', true), 2);
		assert.equal(parseDuration('P'), null);
	});

	test('maps Outlook and unknown zone ids', () => {
		assert.equal(resolveZone('Eastern Standard Time', 'UTC'), 'America/New_York');
		assert.equal(resolveZone('/mozilla.org/20070129_1/Europe/Paris', 'UTC'), 'Europe/Paris');
		assert.equal(resolveZone('(UTC-08:00) Pacific Time (US & Canada)', 'UTC'), 'America/Los_Angeles');
		const zones = new Map([['Custom Zone', { standard: -300, daylight: -240 }]]);
		assert.equal(resolveZone('Custom Zone', 'UTC', zones, 2026), 'America/New_York');
		assert.equal(resolveZone('Nowhere', 'Asia/Tokyo'), 'Asia/Tokyo');
	});

	test('normalises repeat rules from other calendars', () => {
		const times = { allDay: false, start: '2026-11-15T15:00:00.000Z', end: '2026-11-15T16:00:00.000Z', timeZone: 'America/Toronto', startDate: '2026-11-15' };
		assert.equal(formatRecurrence(importRecurrence('FREQ=MONTHLY;BYMONTHDAY=15', times)!), 'FREQ=MONTHLY');
		assert.equal(formatRecurrence(importRecurrence('FREQ=MONTHLY;BYDAY=SU;BYSETPOS=3', times)!), 'FREQ=MONTHLY;BYDAY=3SU');
		assert.equal(formatRecurrence(importRecurrence('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=15', times)!), 'FREQ=YEARLY');
		assert.equal(formatRecurrence(importRecurrence('FREQ=WEEKLY', times)!), 'FREQ=WEEKLY;BYDAY=SU');
		assert.equal(importRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15', times), null);
		assert.equal(importRecurrence('FREQ=HOURLY', times), null);
	});

	test('writes calendars other apps read back the same', () => {
		const text = buildICalendar({
			method: 'REQUEST',
			now: Date.UTC(2026, 10, 14),
			events: [
				{
					uid: 'e1@quickmail',
					sequence: 3,
					title: 'Standup; daily, mostly',
					description: 'Line one\nLine two',
					allDay: false,
					start: '2026-11-16T14:00:00.000Z',
					end: '2026-11-16T14:15:00.000Z',
					timeZone: 'America/Toronto',
					rrule: 'FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261215',
					exdates: ['2026-11-17'],
					organizer: { email: 'me@quickmail.test', name: 'Me' },
					attendees: [{ email: 'sam@example.com', name: 'Sam', status: 'accepted', rsvp: true }]
				}
			]
		});
		assert.ok(text.includes('BEGIN:VTIMEZONE\r\nTZID:America/Toronto'));
		assert.ok(text.includes('DTSTART;TZID=America/Toronto:20261116T090000'));
		assert.ok(text.includes('EXDATE;TZID=America/Toronto:20261117T090000'));
		// UNTIL becomes the end of that day in UTC, matching DTSTART's type.
		assert.ok(text.includes('UNTIL=20261216T045959Z'));
		assert.ok(text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
		const back = parseICalendar(text);
		const event = back.events[0];
		assert.equal(back.method, 'REQUEST');
		assert.equal(event.summary, 'Standup; daily, mostly');
		assert.equal(event.description, 'Line one\nLine two');
		assert.equal(event.sequence, 3);
		assert.equal(event.attendees[0].partstat, 'ACCEPTED');
		const times = resolveTimes(event, 'UTC', back.zones);
		assert.equal(times.start, '2026-11-16T14:00:00.000Z');
		assert.equal(formatRecurrence(importRecurrence(event.rrule!, times)!), 'FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261215');
		// The generated zone has the 2026 changes: DST ends Nov 1 at 2am.
		assert.ok(text.includes('BEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500'));
	});

	test('folds long lines without splitting characters', () => {
		const line = `DESCRIPTION:${'é'.repeat(80)}`;
		const folded = foldLine(line);
		for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75);
		assert.equal(folded.replace(/\r\n /g, ''), line);
	});

	test('rejects files that are not calendars', () => {
		assert.throws(() => parseICalendar('hello'), /not a calendar/);
	});
});

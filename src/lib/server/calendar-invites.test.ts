import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from 'bun:sqlite';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import { buildICalendar, parseICalendar } from '$lib/calendar/ical';
import { createTestBucket, createTestDb } from './testing/sqlite-d1';
import { createEvent, getEvent, listCalendars, listOccurrences, readAttendees, updateEvent, validateEventInput, type ValidEvent } from './calendar-store';
import { applyCalendarMail, describeInvite, loadGroup, notifyGuests, respondToInvite, type InviteContext } from './calendar-invites';
import { dueReminders, runCalendarReminders } from './calendar-reminders';
import { insertEmail } from './mail-store';
import type { EmailProvider } from './email-provider';
import type { OutboundMailInput } from './send-mail';

let sqlite: Database;
let db: D1Database;
let bucket: R2Bucket;
let sent: OutboundMailInput[];
let ctx: InviteContext;
const TZ = 'America/Toronto';
const owner: User = { id: 'owner', email: 'owner@example.com', name: 'Owner', is_admin: true, created_at: '2026-01-01' };

beforeEach(() => {
	({ sqlite, db } = createTestDb());
	bucket = createTestBucket();
	sqlite.exec(`INSERT INTO users(id,email,name,password_hash,is_admin) VALUES('owner','owner@example.com','Owner','x',1);
		INSERT INTO domains(id,name,status,sending_enabled,receiving_enabled) VALUES('d','example.com','verified',1,1);
		INSERT INTO addresses(id,user_id,domain_id,address,is_default) VALUES('a','owner','d','owner@example.com',1)`);
	sent = [];
	const provider = {
		kind: 'cloudflare',
		async send(input: OutboundMailInput) {
			sent.push(input);
			return { providerId: `p${sent.length}` };
		}
	} as unknown as EmailProvider;
	ctx = { env: { DB: db, ATTACHMENTS: bucket }, provider, user: owner, origin: 'https://mail.example.com' };
});

afterEach(() => sqlite.close());

function ics(input: OutboundMailInput): string {
	const file = input.attachments?.find((attachment) => attachment.filename === 'invite.ics');
	assert.ok(file, 'invite.ics attached');
	return new TextDecoder().decode(Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)));
}

async function ownEvent(fields: Record<string, unknown> = {}): Promise<ValidEvent> {
	const calendarId = (await listCalendars(db, 'owner'))[0].id;
	const checked = validateEventInput({ calendarId, title: 'Planning', allDay: false, timeZone: TZ, start: '2026-11-18T15:00:00Z', end: '2026-11-18T16:00:00Z', rrule: null, ...fields }, [calendarId]);
	assert.ok(checked.ok, checked.ok ? '' : checked.error);
	return checked.value;
}

/** Delivers a calendar file to the owner's inbox, as the inbound handlers store it. */
async function receive(from: string, text: string, subject = 'Invitation'): Promise<string> {
	const id = await insertEmail(db, { userId: 'owner', direction: 'inbound', from, to: 'owner@example.com', subject, bodyText: 'see invite', messageId: `${crypto.randomUUID()}@example.com`, domainId: 'd' });
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	sqlite.query('INSERT INTO email_attachments(id,email_id,filename,content_type,size_bytes,content_base64,storage_key) VALUES(?,?,?,?,?,?,NULL)').run(crypto.randomUUID(), id, 'invite.ics', 'text/calendar', bytes.length, btoa(binary));
	return id;
}

function invitation(fields: { method?: string; sequence?: number; start?: string; end?: string; partstat?: string; recurrenceId?: string; status?: string } = {}): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`METHOD:${fields.method ?? 'REQUEST'}`,
		'BEGIN:VEVENT',
		'UID:series-1@example.org',
		`SEQUENCE:${fields.sequence ?? 0}`,
		`DTSTART;TZID=America/Toronto:${fields.start ?? '20261116T100000'}`,
		`DTEND;TZID=America/Toronto:${fields.end ?? '20261116T110000'}`,
		fields.recurrenceId ? `RECURRENCE-ID;TZID=America/Toronto:${fields.recurrenceId}` : 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
		'SUMMARY:Weekly sync',
		'ORGANIZER;CN=Sam:mailto:sam@example.org',
		`ATTENDEE;PARTSTAT=${fields.partstat ?? 'NEEDS-ACTION'};RSVP=TRUE:mailto:owner@example.com`,
		'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.org',
		fields.status ? `STATUS:${fields.status}` : '',
		'END:VEVENT',
		'END:VCALENDAR'
	]
		.filter(Boolean)
		.join('\r\n');
}

describe('calendar invitations', () => {
	test('the organizer side: invite, update, guest answers, removal', async () => {
		const id = (await createEvent(db, 'owner', await ownEvent({ attendees: [{ email: 'sam@example.org', name: 'Sam' }] })))!;
		const row = (await getEvent(db, 'owner', id))!;
		assert.equal(await notifyGuests(ctx, row.ical_uid!, [], await loadGroup(db, 'owner', row.ical_uid!)).then((w) => w.length), 0);
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].to, ['sam@example.org']);
		assert.match(sent[0].subject, /^Invitation: Planning @ /);
		const request = parseICalendar(ics(sent[0]));
		assert.equal(request.method, 'REQUEST');
		assert.equal(request.events[0].organizer?.email, 'owner@example.com');
		assert.equal(request.events[0].attendees[0].email, 'sam@example.org');

		// Sam accepts by email.
		const reply = buildICalendar({ method: 'REPLY', events: [{ uid: row.ical_uid!, title: 'Planning', allDay: false, start: row.start_at, end: row.end_at, timeZone: TZ, organizer: { email: 'owner@example.com' }, attendees: [{ email: 'sam@example.org', status: 'accepted' }] }] });
		await applyCalendarMail({ DB: db, ATTACHMENTS: bucket }, 'owner', await receive('sam@example.org', reply, 'Accepted: Planning'));
		assert.equal(readAttendees((await getEvent(db, 'owner', id))!)[0].status, 'accepted');

		// A new time is sent as an update and asks everyone again.
		const before = await loadGroup(db, 'owner', row.ical_uid!);
		await updateEvent(db, 'owner', (await getEvent(db, 'owner', id))!, await ownEvent({ start: '2026-11-18T17:00:00Z', end: '2026-11-18T18:00:00Z', attendees: [{ email: 'sam@example.org' }] }), 'all', null);
		await notifyGuests(ctx, row.ical_uid!, before, await loadGroup(db, 'owner', row.ical_uid!));
		assert.equal(sent.length, 2);
		assert.match(sent[1].subject, /^Updated invitation: /);
		const updated = (await getEvent(db, 'owner', id))!;
		assert.equal(updated.sequence, 2);
		assert.equal(readAttendees(updated)[0].status, 'needs-action');

		// Only reminders changed: nobody is emailed.
		const quiet = await loadGroup(db, 'owner', row.ical_uid!);
		await updateEvent(db, 'owner', updated, await ownEvent({ start: '2026-11-18T17:00:00Z', end: '2026-11-18T18:00:00Z', attendees: [{ email: 'sam@example.org' }], reminders: [30] }), 'all', null);
		await notifyGuests(ctx, row.ical_uid!, quiet, await loadGroup(db, 'owner', row.ical_uid!));
		assert.equal(sent.length, 2);

		// Removing the guest cancels for them.
		const withGuest = await loadGroup(db, 'owner', row.ical_uid!);
		await updateEvent(db, 'owner', (await getEvent(db, 'owner', id))!, await ownEvent({ start: '2026-11-18T17:00:00Z', end: '2026-11-18T18:00:00Z', attendees: [] }), 'all', null);
		await notifyGuests(ctx, row.ical_uid!, withGuest, await loadGroup(db, 'owner', row.ical_uid!));
		assert.equal(sent.length, 3);
		assert.match(sent[2].subject, /^Canceled: /);
		assert.equal(parseICalendar(ics(sent[2])).method, 'CANCEL');
	});

	test('the guest side: answer, organizer update, single-date cancel, full cancel', async () => {
		const env = { DB: db, ATTACHMENTS: bucket };
		const emailId = await receive('sam@example.org', invitation());
		// Not answered yet: nothing in the calendar.
		const view = (await describeInvite(env, owner, emailId))!;
		assert.equal(view.method, 'REQUEST');
		assert.equal(view.myStatus, null);
		assert.equal(view.repeat, 'Weekly on Mon, 4 times');
		await applyCalendarMail(env, 'owner', emailId);
		assert.equal((await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ })).length, 0);

		const answered = await respondToInvite(ctx, emailId, 'accepted');
		assert.ok(answered.ok);
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].to, ['sam@example.org']);
		assert.match(sent[0].subject, /^Accepted: Weekly sync/);
		const reply = parseICalendar(ics(sent[0]));
		assert.equal(reply.method, 'REPLY');
		assert.equal(reply.events[0].attendees[0].partstat, 'ACCEPTED');
		let occurrences = await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ });
		assert.equal(occurrences.length, 4);
		assert.equal(occurrences[0].myStatus, 'accepted');
		assert.equal(occurrences[0].start, '2026-11-16T15:00:00.000Z');
		assert.deepEqual(occurrences[0].reminders, [10]);
		assert.equal((await describeInvite(env, owner, emailId))!.myStatus, 'accepted');

		// The organizer moves the series to 11:00: applied, answer kept.
		await applyCalendarMail(env, 'owner', await receive('sam@example.org', invitation({ sequence: 1, start: '20261116T110000', end: '20261116T120000' }), 'Updated invitation'));
		occurrences = await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ });
		assert.equal(occurrences.length, 4);
		assert.equal(occurrences[0].start, '2026-11-16T16:00:00.000Z');
		assert.equal(occurrences[0].myStatus, 'accepted');

		// An older copy arriving late changes nothing.
		await applyCalendarMail(env, 'owner', await receive('sam@example.org', invitation({ sequence: 0 })));
		assert.equal((await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-11-17', timeZone: TZ }))[0].start, '2026-11-16T16:00:00.000Z');

		// One date canceled.
		await applyCalendarMail(env, 'owner', await receive('sam@example.org', invitation({ method: 'CANCEL', sequence: 2, recurrenceId: '20261123T110000', start: '20261123T110000', end: '20261123T120000' }), 'Canceled'));
		occurrences = await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ });
		assert.deepEqual(occurrences.map((o) => o.occurrenceKey), ['2026-11-16', '2026-11-30', '2026-12-07']);

		// Someone else cannot cancel Sam's event.
		const spoof = invitation({ method: 'CANCEL', sequence: 9 }).replace('mailto:sam@example.org\r\nATTENDEE', 'mailto:mallory@example.net\r\nATTENDEE').replace('ORGANIZER;CN=Sam:mailto:sam@example.org', 'ORGANIZER:mailto:mallory@example.net');
		await applyCalendarMail(env, 'owner', await receive('mallory@example.net', spoof));
		assert.equal((await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ })).length, 3);

		// The whole series canceled.
		await applyCalendarMail(env, 'owner', await receive('sam@example.org', invitation({ method: 'CANCEL', sequence: 3 }), 'Canceled'));
		assert.equal((await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ })).length, 0);
	});

	test('declining keeps the event out of the calendar', async () => {
		const emailId = await receive('sam@example.org', invitation());
		const declined = await respondToInvite(ctx, emailId, 'declined');
		assert.ok(declined.ok);
		assert.match(sent[0].subject, /^Declined: /);
		assert.equal((await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-15', timeZone: TZ })).length, 0);
		assert.equal((await describeInvite({ DB: db, ATTACHMENTS: bucket }, owner, emailId))!.myStatus, 'declined');
	});
});

describe('calendar reminders', () => {
	test('fire once when due, including repeating and all-day events', async () => {
		const now = Date.parse('2026-11-18T14:50:00Z');
		await createEvent(db, 'owner', await ownEvent({ reminders: [10] }));
		await createEvent(db, 'owner', await ownEvent({ title: 'Daily', start: '2026-11-10T15:00:00Z', end: '2026-11-10T15:30:00Z', rrule: 'FREQ=DAILY', reminders: [10, 60] }));
		await createEvent(db, 'owner', await ownEvent({ title: 'Trip', allDay: true, start: '2026-11-19', end: '2026-11-20', reminders: [1440] }));
		const rows = sqlite.query('SELECT * FROM calendar_events').all() as never[];
		const due = rows.flatMap((row) => dueReminders(row, now));
		assert.deepEqual(due.map((reminder) => [reminder.row.title, reminder.minutes]).sort(), [['Daily', 10], ['Planning', 10]]);
		// 9am the day before the trip, Toronto time (and the daily event's 1-hour reminder).
		const morning = rows.flatMap((row) => dueReminders(row, Date.parse('2026-11-18T14:00:00Z')));
		assert.deepEqual(morning.map((reminder) => `${reminder.row.title} ${reminder.minutes}`).sort(), ['Daily 60', 'Trip 1440']);

		assert.equal(await runCalendarReminders({ DB: db }, now), 2);
		assert.equal(await runCalendarReminders({ DB: db }, now + 60_000), 0);
	});
});

describe('calendar files', () => {
	test('import adds events and a second import updates them', async () => {
		const { importICalendar, buildFeed, syncSubscription } = await import('./calendar-ics');
		const { createCalendar } = await import('./calendar-store');
		const calendarId = (await listCalendars(db, 'owner'))[0].id;
		const file = (title: string) =>
			parseICalendar(
				['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:one', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261226', `SUMMARY:${title}`, 'END:VEVENT', 'BEGIN:VEVENT', 'UID:two', 'DTSTART:20261201T170000Z', 'DTEND:20261201T180000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15', 'SUMMARY:Odd repeat', 'ATTENDEE:mailto:x@example.org', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
			);
		assert.deepEqual(await importICalendar(db, 'owner', calendarId, file('Holidays'), TZ), { added: 2, updated: 0, simplified: 1, skipped: 0 });
		assert.deepEqual(await importICalendar(db, 'owner', calendarId, file('Holidays!'), TZ), { added: 0, updated: 2, simplified: 1, skipped: 0 });
		const occurrences = await listOccurrences(db, 'owner', { fromDate: '2026-11-30', toDate: '2027-01-01', timeZone: TZ });
		assert.deepEqual(occurrences.map((o) => o.title), ['Odd repeat', 'Holidays!']);
		// Imports never carry guests, so editing them emails nobody.
		assert.deepEqual(occurrences[0].attendees, []);

		// The subscribe link lists them; a subscription reads a feed into its own calendar.
		const feed = await buildFeed(db, 'owner', 'QuickMail');
		assert.ok(feed.includes('UID:one') && feed.includes('SUMMARY:Holidays!'));
		const subscribed = (await createCalendar(db, 'owner', 'Feed', '#2f6fd6', 'https://feeds.example.org/cal.ics'))!;
		const fakeFetch = (async () => new Response(feed, { headers: { 'content-type': 'text/calendar' } })) as unknown as typeof fetch;
		const synced = await syncSubscription(db, 'owner', subscribed, TZ, fakeFetch);
		assert.ok(synced.ok);
		const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
		assert.deepEqual(await syncSubscription(db, 'owner', subscribed, TZ, failing), { ok: false, error: 'The calendar link answered with 404.' });
		const all = await listOccurrences(db, 'owner', { fromDate: '2026-12-20', toDate: '2026-12-27', timeZone: TZ });
		assert.equal(all.filter((o) => o.calendarId === subscribed.id).length, 1);
	});
});

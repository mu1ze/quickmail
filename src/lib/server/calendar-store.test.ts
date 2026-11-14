/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import {
	createEvent,
	deleteCalendar,
	deleteEvent,
	getEvent,
	listCalendars,
	listOccurrences,
	updateEvent,
	validateEventInput,
	type ValidEvent
} from './calendar-store';
import { authorizeApiRequest } from './api-access';

let sqlite: Database;
let db: D1Database;
const TZ = 'America/Toronto';

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	db = {
		async batch(statements: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
			catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
		},
		prepare(sql: string) {
			let values: any[] = [];
			return {
				bind(...args: any[]) { values = args; return this; },
				async all() { return { results: sqlite.query(sql).all(...values) }; },
				async first() { return sqlite.query(sql).get(...values); },
				async run() { return { meta: { changes: sqlite.query(sql).run(...values).changes } }; }
			};
		}
	} as unknown as D1Database;
	sqlite.exec("INSERT INTO users(id,email,name,password_hash) VALUES('owner','owner@example.com','Owner','x'),('other','other@example.com','Other','x')");
});

afterEach(() => sqlite.close());

async function calendarId(userId = 'owner') {
	return (await listCalendars(db, userId))[0].id;
}

async function event(fields: Partial<ValidEvent> & Record<string, unknown>, userId = 'owner'): Promise<ValidEvent> {
	const checked = validateEventInput({ calendarId: await calendarId(userId), title: 'Standup', allDay: false, timeZone: TZ, start: '2026-11-16T14:00:00Z', end: '2026-11-16T14:30:00Z', rrule: null, ...fields }, [await calendarId(userId)]);
	assert.ok(checked.ok, checked.ok ? '' : checked.error);
	return checked.value;
}

async function keys(from = '2026-11-15', to = '2026-12-06', userId = 'owner') {
	return (await listOccurrences(db, userId, { fromDate: from, toDate: to, timeZone: TZ })).map((o) => `${o.title}@${o.occurrenceKey ?? o.start.slice(0, 10)}`);
}

describe('calendar store', () => {
	test('each user gets one default calendar that cannot be deleted', async () => {
		const [first] = await listCalendars(db, 'owner');
		const again = await listCalendars(db, 'owner');
		assert.equal(again.length, 1);
		assert.equal(first.is_default, true);
		assert.equal(await deleteCalendar(db, 'owner', first.id), 'default');
		assert.equal(await deleteCalendar(db, 'other', first.id), 'missing');
	});

	test('validation normalises times and rejects bad input', async () => {
		const id = await calendarId();
		const ok = validateEventInput({ calendarId: id, title: '  Lunch ', allDay: false, timeZone: TZ, start: '2026-11-16T12:00-05:00', end: '2026-11-16T13:00-05:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }, [id]);
		assert.ok(ok.ok);
		if (ok.ok) {
			assert.equal(ok.value.title, 'Lunch');
			assert.equal(ok.value.start, '2026-11-16T17:00:00.000Z');
		}
		const bad = [
			{ calendarId: 'someone-else' },
			{ timeZone: 'Mars/Olympus' },
			{ end: '2026-11-16T11:00:00-05:00' },
			{ rrule: 'FREQ=MINUTELY' },
			{ rrule: 'FREQ=DAILY;UNTIL=20261101' },
			{ allDay: true, start: '2026-11-16', end: '2026-11-16' },
			{ title: 'x'.repeat(301) }
		];
		for (const fields of bad) {
			const result = validateEventInput({ calendarId: id, title: 'A', allDay: false, timeZone: TZ, start: '2026-11-16T12:00-05:00', end: '2026-11-16T13:00-05:00', ...fields }, [id]);
			assert.equal(result.ok, false, JSON.stringify(fields));
		}
	});

	test('lists single, all-day and repeating events in the window, per user', async () => {
		await createEvent(db, 'owner', await event({ title: 'Dentist', start: '2026-11-20T15:00:00Z', end: '2026-11-20T16:00:00Z' }));
		await createEvent(db, 'owner', await event({ title: 'Trip', allDay: true, start: '2026-11-27', end: '2026-11-30' }));
		await createEvent(db, 'owner', await event({ title: 'Standup', rrule: 'FREQ=WEEKLY;COUNT=3' }));
		await createEvent(db, 'owner', await event({ title: 'Old', start: '2026-10-01T15:00:00Z', end: '2026-10-01T16:00:00Z' }));
		await createEvent(db, 'other', await event({ title: 'Private' }, 'other'));
		assert.deepEqual(await keys(), ['Standup@2026-11-16', 'Dentist@2026-11-20', 'Standup@2026-11-23', 'Trip@2026-11-27', 'Standup@2026-11-30']);
		// A finished series is skipped by the query itself.
		assert.deepEqual(sqlite.query("SELECT recur_until FROM calendar_events WHERE title='Standup'").get(), { recur_until: '2026-11-30T14:30:00.000Z' });
		assert.deepEqual(await keys('2026-12-01', '2026-12-31'), []);
	});

	test('editing one occurrence detaches it from the series', async () => {
		const id = (await createEvent(db, 'owner', await event({ rrule: 'FREQ=WEEKLY' })))!;
		const row = (await getEvent(db, 'owner', id))!;
		await updateEvent(db, 'owner', row, await event({ title: 'Moved standup', start: '2026-11-24T15:00:00Z', end: '2026-11-24T15:30:00Z', rrule: 'FREQ=WEEKLY' }), 'this', '2026-11-23');
		assert.deepEqual(await keys(), ['Standup@2026-11-16', 'Moved standup@2026-11-24', 'Standup@2026-11-30']);
	});

	test('editing following occurrences splits the series', async () => {
		const id = (await createEvent(db, 'owner', await event({ rrule: 'FREQ=WEEKLY' })))!;
		const row = (await getEvent(db, 'owner', id))!;
		await updateEvent(db, 'owner', row, await event({ title: 'Later standup', start: '2026-11-23T16:00:00Z', end: '2026-11-23T16:30:00Z', rrule: 'FREQ=WEEKLY' }), 'following', '2026-11-23');
		assert.deepEqual(await keys(), ['Standup@2026-11-16', 'Later standup@2026-11-23', 'Later standup@2026-11-30']);
	});

	test('editing all occurrences from a later one moves the whole series', async () => {
		const id = (await createEvent(db, 'owner', await event({ rrule: 'FREQ=WEEKLY;COUNT=3' })))!;
		const row = (await getEvent(db, 'owner', id))!;
		// Drag the 2nd occurrence from Monday to Tuesday at 11:00 local.
		await updateEvent(db, 'owner', row, await event({ start: '2026-11-24T16:00:00Z', end: '2026-11-24T16:30:00Z', rrule: 'FREQ=WEEKLY;COUNT=3' }), 'all', '2026-11-23');
		const listed = await listOccurrences(db, 'owner', { fromDate: '2026-11-15', toDate: '2026-12-06', timeZone: TZ });
		assert.deepEqual(listed.map((o) => o.start), ['2026-11-17T16:00:00.000Z', '2026-11-24T16:00:00.000Z', '2026-12-01T16:00:00.000Z']);
	});

	test('deleting this, following or all occurrences', async () => {
		const id = (await createEvent(db, 'owner', await event({ rrule: 'FREQ=WEEKLY' })))!;
		await deleteEvent(db, (await getEvent(db, 'owner', id))!, 'this', '2026-11-23');
		assert.deepEqual(await keys(), ['Standup@2026-11-16', 'Standup@2026-11-30']);
		await deleteEvent(db, (await getEvent(db, 'owner', id))!, 'following', '2026-11-30');
		assert.deepEqual(await keys(), ['Standup@2026-11-16']);
		await deleteEvent(db, (await getEvent(db, 'owner', id))!, 'following', '2026-11-16');
		assert.deepEqual(await keys(), []);
	});

	test('API keys need calendar scopes; invitations and settings stay session-only', () => {
		const allow = (pathname: string, method: string, scopes: any[]) => authorizeApiRequest({ pathname, method, authMethod: 'api_token', scopes }).ok;
		for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
			assert.equal(allow(method === 'GET' || method === 'POST' ? '/api/calendar/events' : '/api/calendar/events/e1', method, ['mail:read', 'mail:send', 'admin']), false, method);
		}
		assert.equal(allow('/api/calendar/events', 'GET', ['calendar:read']), true);
		assert.equal(allow('/api/calendar/events', 'POST', ['calendar:read']), false);
		assert.equal(allow('/api/calendar/events', 'POST', ['calendar:write']), true);
		assert.equal(allow('/api/calendar/events/e1', 'PATCH', ['calendar:write']), true);
		assert.equal(allow('/api/calendar/calendars/c1', 'DELETE', ['calendar:write']), true);
		assert.equal(allow('/api/calendar/import', 'POST', ['calendar:write']), true);
		assert.equal(allow('/api/calendar/settings', 'PATCH', ['calendar:write']), false);
		assert.equal(allow('/api/calendar/invites/m1', 'POST', ['calendar:write', 'mail:send']), false);
	});
});

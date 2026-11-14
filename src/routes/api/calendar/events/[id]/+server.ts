import { json, type RequestHandler } from '@sveltejs/kit';
import { cleanReminders, deleteEvent, getEvent, listCalendars, updateEvent, validateEventInput, writableCalendarIds } from '$lib/server/calendar-store';
import { loadGroup } from '$lib/server/calendar-invites';
import { guestMailer, withoutOwnAddresses } from '$lib/server/calendar-api';
import { isDateKey } from '$lib/calendar/time';
import type { EditScope } from '$lib/calendar/types';

function readScope(value: unknown): EditScope | null {
	return value === 'this' || value === 'following' || value === 'all' ? value : null;
}

const READ_ONLY = 'Events in a subscribed calendar cannot be changed here.';

export const PATCH: RequestHandler = async ({ params, request, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const user = locals.user;
	const row = await getEvent(db, user.id, params.id!);
	if (!row) return json({ error: 'Event not found' }, { status: 404 });
	const calendars = await listCalendars(db, user.id);
	const writable = writableCalendarIds(calendars);
	if (!writable.includes(row.calendar_id)) return json({ error: READ_ONLY }, { status: 403 });
	const body = await request.json().catch(() => null);

	if (row.my_email) {
		// Someone else's invitation: the organizer owns the details; the user picks
		// the calendar and their own reminders.
		const calendarId = typeof body?.calendarId === 'string' && writable.includes(body.calendarId) ? body.calendarId : row.calendar_id;
		const reminders = cleanReminders(body?.reminders);
		if (!reminders) return json({ error: 'Add up to 5 reminders, each up to four weeks before.' }, { status: 400 });
		await db
			.prepare(`UPDATE calendar_events SET calendar_id = ?, reminders = ?, updated_at = datetime('now') WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL`)
			.bind(calendarId, JSON.stringify(reminders), user.id, row.ical_uid)
			.run();
		return json({ id: row.id, warnings: [] });
	}

	const scope = readScope(body?.scope ?? 'all');
	const occurrenceKey = body?.occurrenceKey ?? null;
	if (!scope || (occurrenceKey !== null && !isDateKey(occurrenceKey))) return json({ error: 'Choose which events to change.' }, { status: 400 });
	const checked = validateEventInput(body, writable);
	if (!checked.ok) return json({ error: checked.error }, { status: 400 });
	checked.value.attendees = await withoutOwnAddresses(platform, user.id, checked.value.attendees);
	const before = row.ical_uid ? await loadGroup(db, user.id, row.ical_uid) : [row];
	const result = await updateEvent(db, user.id, row, checked.value, scope, occurrenceKey);
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	const changes = [{ uid: row.ical_uid, before }];
	if (result.id !== row.id) {
		const created = await getEvent(db, user.id, result.id);
		if (created?.ical_uid && created.ical_uid !== row.ical_uid) changes.push({ uid: created.ical_uid, before: [] });
	}
	const warnings = await guestMailer(platform, user, url.origin)(changes);
	return json({ ...result, warnings });
};

/** `?scope=this|following|all&occurrence=2026-11-14` for repeating events. */
export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const user = locals.user;
	const row = await getEvent(db, user.id, params.id!);
	if (!row) return json({ error: 'Event not found' }, { status: 404 });
	const calendars = await listCalendars(db, user.id);
	if (!writableCalendarIds(calendars).includes(row.calendar_id)) return json({ error: READ_ONLY }, { status: 403 });
	const scope = readScope(url.searchParams.get('scope') ?? 'all');
	const occurrence = url.searchParams.get('occurrence');
	if (!scope || (occurrence !== null && !isDateKey(occurrence))) return json({ error: 'Choose which events to delete.' }, { status: 400 });
	if (row.my_email && scope === 'all') {
		// Removing an invitation only takes it off this calendar.
		await db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL').bind(user.id, row.ical_uid).run();
		return json({ ok: true, warnings: [] });
	}
	const before = row.ical_uid && !row.my_email ? await loadGroup(db, user.id, row.ical_uid) : [];
	await deleteEvent(db, row, scope, occurrence);
	const warnings = before.length ? await guestMailer(platform, user, url.origin)([{ uid: row.ical_uid, before }]) : [];
	return json({ ok: true, warnings });
};

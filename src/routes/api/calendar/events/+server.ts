import { json, type RequestHandler } from '@sveltejs/kit';
import { clampWindow, createEvent, getEvent, listCalendars, listOccurrences, validateEventInput, writableCalendarIds } from '$lib/server/calendar-store';
import { guestMailer, withoutOwnAddresses } from '$lib/server/calendar-api';
import { isDateKey, isValidTimeZone } from '$lib/calendar/time';

/** `?from=2026-11-01&to=2026-12-01&tz=America/Toronto` — days are in `tz`, `to` is exclusive. */
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const tz = url.searchParams.get('tz') ?? 'UTC';
	if (!isDateKey(from) || !isDateKey(to) || !clampWindow(from, to)) return json({ error: 'Use from/to dates up to 400 days apart.' }, { status: 400 });
	if (!isValidTimeZone(tz)) return json({ error: 'Unknown time zone.' }, { status: 400 });
	return json({ events: await listOccurrences(platform.env.DB, locals.user.id, { fromDate: from, toDate: to, timeZone: tz }) });
};

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const calendars = await listCalendars(db, locals.user.id);
	const checked = validateEventInput(await request.json().catch(() => null), writableCalendarIds(calendars));
	if (!checked.ok) return json({ error: checked.error }, { status: 400 });
	checked.value.attendees = await withoutOwnAddresses(platform, locals.user.id, checked.value.attendees);
	const id = await createEvent(db, locals.user.id, checked.value);
	if (!id) return json({ error: 'You have reached the event limit.' }, { status: 400 });
	let warnings: string[] = [];
	if (checked.value.attendees.length) {
		const row = await getEvent(db, locals.user.id, id);
		warnings = await guestMailer(platform, locals.user, url.origin)([{ uid: row?.ical_uid ?? null, before: [] }]);
	}
	return json({ id, warnings }, { status: 201 });
};

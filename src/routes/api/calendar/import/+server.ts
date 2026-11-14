import { json, type RequestHandler } from '@sveltejs/kit';
import { parseICalendar } from '$lib/calendar/ical';
import { importICalendar } from '$lib/server/calendar-ics';
import { getCalendarSettings } from '$lib/server/calendar-settings';
import { listCalendars, writableCalendarIds } from '$lib/server/calendar-store';

/** `{ calendarId, ics }` — adds a calendar file's events; re-importing replaces them. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const body = await request.json().catch(() => null);
	const calendars = await listCalendars(db, locals.user.id);
	if (typeof body?.calendarId !== 'string' || !writableCalendarIds(calendars).includes(body.calendarId)) return json({ error: 'Choose one of your calendars.' }, { status: 400 });
	if (typeof body?.ics !== 'string' || !body.ics.trim()) return json({ error: 'Choose a .ics file.' }, { status: 400 });
	let parsed;
	try {
		parsed = parseICalendar(body.ics);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'That file could not be read.' }, { status: 400 });
	}
	if (!parsed.events.length) return json({ error: 'That file has no events.' }, { status: 400 });
	const settings = await getCalendarSettings(db, locals.user.id);
	const result = await importICalendar(db, locals.user.id, body.calendarId, parsed, settings.timeZone);
	return json({ result });
};

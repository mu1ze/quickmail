import { json, type RequestHandler } from '@sveltejs/kit';
import { cleanCalendarColor, cleanCalendarName, createCalendar, deleteCalendar, getCalendar, listCalendars, MAX_CALENDARS } from '$lib/server/calendar-store';
import { normalizeFeedUrl, syncSubscription } from '$lib/server/calendar-ics';
import { getCalendarSettings } from '$lib/server/calendar-settings';
import { CALENDAR_COLORS } from '$lib/calendar/types';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ calendars: await listCalendars(platform.env.DB, locals.user.id) });
};

/** `{ name, color, url? }` — with a URL, the calendar is a read-only subscription to that feed. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const body = await request.json().catch(() => null);
	const name = cleanCalendarName(body?.name);
	if (!name) return json({ error: 'Use a calendar name between 1 and 60 characters.' }, { status: 400 });
	let sourceUrl: string | null = null;
	if (body?.url !== undefined && body?.url !== null && body?.url !== '') {
		sourceUrl = normalizeFeedUrl(body.url);
		if (!sourceUrl) return json({ error: 'Use a public http(s) or webcal link to a calendar.' }, { status: 400 });
	}
	const existing = await listCalendars(db, locals.user.id);
	const color = cleanCalendarColor(body?.color) ?? CALENDAR_COLORS[existing.length % CALENDAR_COLORS.length];
	const calendar = await createCalendar(db, locals.user.id, name, color, sourceUrl);
	if (!calendar) return json({ error: `You can have up to ${MAX_CALENDARS} calendars.` }, { status: 400 });
	if (sourceUrl) {
		const settings = await getCalendarSettings(db, locals.user.id);
		const synced = await syncSubscription(db, locals.user.id, calendar, settings.timeZone);
		if (!synced.ok) {
			// Nothing to show for a link that does not work: undo and say why.
			await deleteCalendar(db, locals.user.id, calendar.id);
			return json({ error: synced.error }, { status: 400 });
		}
		return json({ calendar: await getCalendar(db, locals.user.id, calendar.id), result: synced.result }, { status: 201 });
	}
	return json({ calendar }, { status: 201 });
};

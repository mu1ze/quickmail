import type { PageServerLoad } from './$types';
import { listCalendars, listOccurrences } from '$lib/server/calendar-store';
import { getCalendarSettings, publicSettings, rememberTimeZone } from '$lib/server/calendar-settings';
import { isDateKey, isValidTimeZone, todayKey } from '$lib/calendar/time';
import { readView, TZ_COOKIE, VIEW_COOKIE, viewRange } from '$lib/calendar/layout';

export const load: PageServerLoad = async ({ locals, platform, url, cookies, depends }) => {
	depends('app:calendar');
	const db = platform?.env.DB;
	const cookieZone = cookies.get(TZ_COOKIE);
	// The browser reports its zone in a cookie so the server renders the same days it will.
	const timeZone = isValidTimeZone(cookieZone) ? cookieZone : 'UTC';
	const today = todayKey(timeZone);
	const view = readView(url.searchParams.get('view'), readView(cookies.get(VIEW_COOKIE)));
	const requested = url.searchParams.get('date');
	const date = isDateKey(requested) ? requested : today;
	const range = viewRange(view, date);
	if (!db || !locals.user) return { timeZone, today, view, date, range, calendars: [], occurrences: [], zoneKnown: Boolean(cookieZone), settings: null };
	const [calendars, occurrences, stored] = await Promise.all([
		listCalendars(db, locals.user.id),
		listOccurrences(db, locals.user.id, { fromDate: range.from, toDate: range.to, timeZone }),
		getCalendarSettings(db, locals.user.id)
	]);
	// Reminders and the daily agenda run on the server, in the zone the user last used.
	if (cookieZone && stored.timeZone !== timeZone) await rememberTimeZone(db, locals.user.id, timeZone);
	return { timeZone, today, view, date, range, calendars, occurrences, zoneKnown: Boolean(cookieZone), settings: publicSettings(stored, url.origin) };
};

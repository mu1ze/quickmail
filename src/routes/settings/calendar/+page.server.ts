import type { PageServerLoad } from './$types';
import { getCalendarSettings, publicSettings } from '$lib/server/calendar-settings';
import { listCalendars } from '$lib/server/calendar-store';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return { calendarSettings: null, calendars: [] };
	const [stored, calendars] = await Promise.all([getCalendarSettings(db, locals.user.id), listCalendars(db, locals.user.id)]);
	return { calendarSettings: publicSettings(stored, url.origin), calendars };
};

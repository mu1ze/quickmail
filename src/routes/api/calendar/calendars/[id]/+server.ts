import { json, type RequestHandler } from '@sveltejs/kit';
import { cleanCalendarColor, cleanCalendarName, deleteCalendar, getCalendar, updateCalendar } from '$lib/server/calendar-store';
import { syncSubscription } from '$lib/server/calendar-ics';
import { getCalendarSettings } from '$lib/server/calendar-settings';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	if (body?.refresh === true) {
		// Re-read a subscription now instead of waiting for the next scheduled refresh.
		const calendar = await getCalendar(platform.env.DB, locals.user.id, params.id!);
		if (!calendar?.source_url) return json({ error: 'Calendar not found' }, { status: 404 });
		const settings = await getCalendarSettings(platform.env.DB, locals.user.id);
		const synced = await syncSubscription(platform.env.DB, locals.user.id, calendar, settings.timeZone);
		return synced.ok ? json({ ok: true, result: synced.result }) : json({ error: synced.error }, { status: 400 });
	}
	const name = body?.name === undefined ? undefined : cleanCalendarName(body.name);
	const color = body?.color === undefined ? undefined : cleanCalendarColor(body.color);
	if (name === null) return json({ error: 'Use a calendar name between 1 and 60 characters.' }, { status: 400 });
	if (color === null) return json({ error: 'Choose a colour like #3f7d5c.' }, { status: 400 });
	if (name === undefined && color === undefined) return json({ error: 'Nothing to change.' }, { status: 400 });
	const updated = await updateCalendar(platform.env.DB, locals.user.id, params.id!, { name, color });
	return updated ? json({ ok: true }) : json({ error: 'Calendar not found' }, { status: 404 });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const outcome = await deleteCalendar(platform.env.DB, locals.user.id, params.id!);
	if (outcome === 'missing') return json({ error: 'Calendar not found' }, { status: 404 });
	if (outcome === 'default') return json({ error: 'Your main calendar cannot be deleted.' }, { status: 400 });
	return json({ ok: true });
};

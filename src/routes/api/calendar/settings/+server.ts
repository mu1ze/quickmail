import { json, type RequestHandler } from '@sveltejs/kit';
import { getCalendarSettings, publicSettings, saveCalendarSettings, setFeedToken, validateSettings } from '$lib/server/calendar-settings';

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ settings: publicSettings(await getCalendarSettings(platform.env.DB, locals.user.id), url.origin) });
};

/** Reminder and agenda preferences, plus `feed: 'on' | 'off' | 'reset'` for the subscribe link. */
export const PATCH: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = platform.env.DB;
	const body = await request.json().catch(() => null);
	const { feed, ...rest } = (body ?? {}) as Record<string, unknown>;
	if (feed !== undefined) {
		if (feed !== 'on' && feed !== 'off' && feed !== 'reset') return json({ error: 'Turn the link on, off, or make a new one.' }, { status: 400 });
		const current = await getCalendarSettings(db, locals.user.id);
		if (feed === 'off' || feed === 'reset' || !current.feedToken) await setFeedToken(db, locals.user.id, feed !== 'off');
	}
	if (Object.keys(rest).length) {
		const checked = validateSettings(rest);
		if (!checked.ok) return json({ error: checked.error }, { status: 400 });
		await saveCalendarSettings(db, locals.user.id, checked.value);
	}
	return json({ settings: publicSettings(await getCalendarSettings(db, locals.user.id), url.origin) });
};

import type { RequestHandler } from '@sveltejs/kit';
import { buildFeed } from '$lib/server/calendar-ics';
import { userForFeedToken } from '$lib/server/calendar-settings';

/**
 * The private subscribe link (`/ical/<token>.ics`). Anyone with the link can read the
 * user's calendars, so the token is long and random and can be replaced in settings.
 */
export const GET: RequestHandler = async ({ params, platform }) => {
	const db = platform?.env.DB;
	const token = params.token!.replace(/\.ics$/i, '');
	const userId = db ? await userForFeedToken(db, token) : null;
	if (!db || !userId) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
	const body = await buildFeed(db, userId, 'QuickMail');
	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'inline; filename="quickmail.ics"',
			'Cache-Control': 'private, max-age=300',
			'X-Robots-Tag': 'noindex'
		}
	});
};

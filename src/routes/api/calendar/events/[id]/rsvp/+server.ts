import { json, type RequestHandler } from '@sveltejs/kit';
import { getEvent } from '$lib/server/calendar-store';
import { respondToEvent } from '$lib/server/calendar-invites';
import { getEmailProvider } from '$lib/server/context';

/** `{ response: 'accepted' | 'tentative' | 'declined' }` for an invitation in the calendar. */
export const POST: RequestHandler = async ({ params, request, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const row = await getEvent(platform.env.DB, locals.user.id, params.id!);
	if (!row) return json({ error: 'Event not found' }, { status: 404 });
	const body = await request.json().catch(() => null);
	const response = body?.response;
	if (response !== 'accepted' && response !== 'tentative' && response !== 'declined') return json({ error: 'Answer yes, maybe or no.' }, { status: 400 });
	let provider;
	try {
		provider = getEmailProvider(platform);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Mail sending is not set up.' }, { status: 503 });
	}
	const result = await respondToEvent({ env: { DB: platform.env.DB, ATTACHMENTS: platform.env.ATTACHMENTS }, provider, user: locals.user, origin: url.origin }, row, response);
	return result.ok ? json({ ok: true, warnings: result.warnings }) : json({ error: result.error }, { status: result.status });
};

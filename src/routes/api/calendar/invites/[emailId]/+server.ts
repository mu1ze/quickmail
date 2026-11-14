import { json, type RequestHandler } from '@sveltejs/kit';
import { describeInvite, respondToInvite } from '$lib/server/calendar-invites';
import { getEmailProvider } from '$lib/server/context';

/** The invitation attached to an email, with the user's answer so far. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const invite = await describeInvite({ DB: platform.env.DB, ATTACHMENTS: platform.env.ATTACHMENTS }, locals.user, params.emailId!);
	return invite ? json({ invite }) : json({ error: 'No invitation in this email.' }, { status: 404 });
};

/** `{ response: 'accepted' | 'tentative' | 'declined', calendarId? }` */
export const POST: RequestHandler = async ({ params, request, url, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const response = body?.response;
	if (response !== 'accepted' && response !== 'tentative' && response !== 'declined') return json({ error: 'Answer yes, maybe or no.' }, { status: 400 });
	let provider;
	try {
		provider = getEmailProvider(platform);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Mail sending is not set up.' }, { status: 503 });
	}
	const result = await respondToInvite(
		{ env: { DB: platform.env.DB, ATTACHMENTS: platform.env.ATTACHMENTS }, provider, user: locals.user, origin: url.origin },
		params.emailId!,
		response,
		typeof body?.calendarId === 'string' ? body.calendarId : null
	);
	if (!result.ok) return json({ error: result.error }, { status: result.status });
	const invite = await describeInvite({ DB: platform.env.DB, ATTACHMENTS: platform.env.ATTACHMENTS }, locals.user, params.emailId!);
	return json({ invite, eventId: result.eventId, warnings: result.warnings });
};

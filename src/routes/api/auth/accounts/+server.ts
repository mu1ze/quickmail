import { json, type RequestHandler } from '@sveltejs/kit';
import { browserSessions, switchBrowserAccount } from '$lib/server/browser-accounts';

export const GET: RequestHandler = async ({ platform, cookies, locals }) => {
	const db = platform?.env.DB;
	if (!db || locals.authMethod === 'api_token') return json({ error: 'Unauthorized' }, { status: 401 });
	const sessions = await browserSessions(db, cookies);
	return json({ accounts: sessions.map(({ user }) => ({ id: user.id, name: user.name, email: user.email })) }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ platform, cookies, request, locals, url }) => {
	const db = platform?.env.DB;
	if (!db || locals.authMethod === 'api_token') return json({ error: 'Unauthorized' }, { status: 401 });
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 });
	}
	const body = await request.json().catch(() => null);
	if (typeof body?.userId !== 'string') return json({ error: 'Choose an account' }, { status: 400 });
	const user = await switchBrowserAccount(db, cookies, body.userId);
	if (!user) return json({ error: 'This account is no longer signed in. Add it again to continue.' }, { status: 401 });
	return json({ user }, { headers: { 'Cache-Control': 'no-store' } });
};

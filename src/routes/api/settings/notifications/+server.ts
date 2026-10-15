import { json, type RequestHandler } from '@sveltejs/kit';
import { loadNotificationPrefs, saveNotificationPrefs } from '$lib/server/notification-preferences';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await loadNotificationPrefs(db, locals.user.id));
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.authMethod !== 'session') {
		return json({ error: 'Sign in with a browser session to change notification settings.' }, { status: 403 });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		return json(await saveNotificationPrefs(db, locals.user.id, body));
	} catch {
		return json({ error: 'Could not save. The database may need migration 0029.' }, { status: 500 });
	}
};

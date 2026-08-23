import { json, type RequestHandler } from '@sveltejs/kit';
import { listRecentContacts } from '$lib/server/mail-store';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const q = url.searchParams.get('q')?.trim() ?? '';
	const exclude = new Set(locals.addresses.map((address) => address.address.toLowerCase()));
	const contacts = await listRecentContacts(db, locals.user.id, q, exclude);
	return json({ contacts });
};

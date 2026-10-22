import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ user: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
	}
	return json({ user: locals.user }, { headers: { 'Cache-Control': 'no-store' } });
};

import { json, type RequestHandler } from '@sveltejs/kit';

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const result = await platform.env.DB.prepare('DELETE FROM mail_labels WHERE id = ? AND user_id = ?').bind(params.id, locals.user.id).run();
	return result.meta.changes ? json({ ok: true }) : json({ error: 'Label not found' }, { status: 404 });
};

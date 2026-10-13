import { json, type RequestHandler } from '@sveltejs/kit';
import { listMailLabels } from '$lib/server/mail-labels';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ labels: await listMailLabels(platform.env.DB, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name)) return json({ error: 'Use a label name between 1 and 60 characters.' }, { status: 400 });
	const labels = await listMailLabels(platform.env.DB, locals.user.id);
	if (labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) return json({ error: 'A label with this name already exists.' }, { status: 409 });
	if (labels.length >= 100) return json({ error: 'You can create up to 100 labels.' }, { status: 400 });
	const id = crypto.randomUUID();
	await platform.env.DB.prepare('INSERT INTO mail_labels(id, user_id, name) VALUES(?, ?, ?)').bind(id, locals.user.id, name).run();
	return json({ id, name }, { status: 201 });
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { applyMailLabels } from '$lib/server/mail-labels';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 50 || body.ids.some((id: unknown) => typeof id !== 'string') || !Array.isArray(body.changes) || body.changes.length > 100 || body.changes.some((change: { labelId?: unknown; apply?: unknown } | null) => !change || typeof change.labelId !== 'string' || typeof change.apply !== 'boolean')) {
		return json({ error: 'Select conversations and valid label changes.' }, { status: 400 });
	}
	const ok = await applyMailLabels(platform.env.DB, locals.user.id, body.ids, body.changes);
	return ok ? json({ ok: true }) : json({ error: 'Conversation or label not found' }, { status: 404 });
};

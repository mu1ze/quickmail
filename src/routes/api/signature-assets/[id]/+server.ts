import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteSignatureAsset } from '$lib/server/signature-assets';

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const removed = await deleteSignatureAsset(db, bucket, locals.user.id, params.id!);
	if (!removed) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	return json({ ok: true });
};

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	insertSignatureAsset,
	MAX_SIGNATURE_ASSET_BYTES
} from '$lib/server/signature-assets';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: 'Invalid upload' }, { status: 400 });
	}

	const file = form.get('file');
	if (!(file instanceof File)) {
		return json({ error: 'Choose an image to upload' }, { status: 400 });
	}
	if (file.size > MAX_SIGNATURE_ASSET_BYTES) {
		return json({ error: 'Image must be 512KB or smaller' }, { status: 400 });
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	try {
		const asset = await insertSignatureAsset(db, bucket, locals.user.id, bytes, file.type);
		return json({ ok: true, id: asset.id, contentType: asset.content_type });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not save that image' },
			{ status: 400 }
		);
	}
};

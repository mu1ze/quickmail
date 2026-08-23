import { error, type RequestHandler } from '@sveltejs/kit';
import { getSignatureAsset, signatureAssetKey } from '$lib/server/signature-assets';

export const GET: RequestHandler = async ({ params, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket) {
		throw error(404, 'Not found');
	}

	const asset = await getSignatureAsset(db, params.id!);
	if (!asset) {
		throw error(404, 'Not found');
	}

	const object = await bucket.get(signatureAssetKey(asset.user_id, asset.id));
	if (!object) {
		throw error(404, 'Not found');
	}

	const body = object.body;
	if (!body) {
		throw error(404, 'Not found');
	}

	return new Response(body, {
		headers: {
			'Content-Type': asset.content_type,
			'Content-Length': String(asset.byte_size),
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};

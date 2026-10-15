import { error, type RequestHandler } from '@sveltejs/kit';
import { getSignatureAsset, signatureAssetKey } from '$lib/server/signature-assets';
import { parseLiveStatusQuery, pickLiveState } from '$lib/signature-live';

/**
 * The live availability badge in a sent signature. The query carries the
 * schedule and the three pre-rendered badges; this picks one for "now" in the
 * sender's zone. Responses are never cached so each open is current. Nothing
 * about the request is stored.
 */
export const GET: RequestHandler = async ({ url, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket) throw error(404, 'Not found');

	const query = parseLiveStatusQuery(url.searchParams);
	if (!query) throw error(404, 'Not found');

	const { ids, schedule } = query;
	const state = pickLiveState(new Date(), schedule, ids.ooo !== null);
	const chosen = state === 'ooo' && ids.ooo ? ids.ooo : state === 'available' ? ids.available : ids.away;

	// All badges must belong to one account, so a link can't stitch together other people's images.
	const [asset, available] = await Promise.all([
		getSignatureAsset(db, chosen),
		chosen === ids.available ? null : getSignatureAsset(db, ids.available)
	]);
	if (!asset || (available && available.user_id !== asset.user_id)) throw error(404, 'Not found');

	const object = await bucket.get(signatureAssetKey(asset.user_id, asset.id));
	if (!object) throw error(404, 'Not found');

	return new Response(await object.arrayBuffer(), {
		headers: {
			'Content-Type': asset.content_type,
			'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
			Expires: '0',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};

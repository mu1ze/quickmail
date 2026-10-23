import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachmentForUser, readAttachmentBytes } from '$lib/server/attachments';
import { isPreviewableInline, normalizeContentType, parseByteRange } from '$lib/utils/attachments';

export const GET: RequestHandler = async ({ params, locals, platform, url, request }) => {
	if (!locals.user || !platform?.env.DB || !platform?.env.ATTACHMENTS) {
		throw error(401, 'Unauthorized');
	}

	const attachment = await getAttachmentForUser(
		platform.env.DB,
		locals.user.id,
		params.id,
		params.attachmentId
	);

	if (!attachment) {
		throw error(404, 'Attachment not found');
	}

	const bucket = platform.env.ATTACHMENTS;
	const rangeHeader = request.headers.get('range');
	const object = attachment.storage_key ? await bucket.head(attachment.storage_key) : null;
	if (attachment.storage_key && !object) throw error(404, 'Attachment not found');
	const bytes = object ? null : await readAttachmentBytes(bucket, attachment);
	if (!object && !bytes) throw error(404, 'Attachment not found');
	const size = object?.size ?? bytes!.length;
	const range = parseByteRange(rangeHeader, size);
	if (rangeHeader && !range)
		return new Response(null, {
			status: 416,
			headers: {
				'Content-Range': `bytes */${size}`,
				'Cache-Control': 'no-store'
			}
		});
	const stored =
		object && attachment.storage_key
			? await bucket.get(
					attachment.storage_key,
					range
						? {
								range: {
									offset: range.start,
									length: range.end - range.start + 1
								}
							}
						: undefined
				)
			: null;
	if (object && !stored) throw error(404, 'Attachment not found');
	// Workers and DOM stream declarations differ; R2 provides the standard stream at runtime.
	const body = stored ? (stored.body as unknown as ReadableStream<Uint8Array>) : range ? new Uint8Array(bytes!.slice(range.start, range.end + 1)) : new Uint8Array(bytes!);
	const length = range ? range.end - range.start + 1 : size;

	const forceDownload = url.searchParams.get('download') === '1';
	const inline = !forceDownload && isPreviewableInline(attachment.content_type);

	const contentType = normalizeContentType(attachment.content_type);
	const safeType = inline ? contentType : 'application/octet-stream';
	const filename = attachment.filename.replace(/[\r\n"\\]/g, '_');
	const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
	const encodedName = encodeURIComponent(filename).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16)}`
	);

	return new Response(body, {
		status: range ? 206 : 200,
		headers: {
			'Content-Type': safeType,
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
			'Content-Length': String(length),
			'Accept-Ranges': 'bytes',
			...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy':
				"default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
			'Cache-Control': 'private, no-store'
		}
	});
};

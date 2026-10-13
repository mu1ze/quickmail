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

	const bytes = await readAttachmentBytes(platform.env.ATTACHMENTS, attachment);
	if (!bytes) {
		throw error(404, 'Attachment not found');
	}

	const forceDownload = url.searchParams.get('download') === '1';
	const inline = !forceDownload && isPreviewableInline(attachment.content_type);

	const rangeHeader = request.headers.get('range');
	const range = parseByteRange(rangeHeader, bytes.length);
	if (rangeHeader && !range) {
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
	}
	const body = range ? bytes.slice(range.start, range.end + 1) : new Uint8Array(bytes);
	const contentType = normalizeContentType(attachment.content_type);
	const safeType = inline ? contentType : 'application/octet-stream';
	const filename = attachment.filename.replace(/[\r\n"\\]/g, '_');
	const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
	const encodedName = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);

	return new Response(body, {
		status: range ? 206 : 200,
		headers: {
			'Content-Type': safeType,
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
			'Content-Length': String(body.length),
			'Accept-Ranges': 'bytes',
			...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } : {}),
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
			'Cache-Control': 'private, max-age=3600'
		}
	});
};

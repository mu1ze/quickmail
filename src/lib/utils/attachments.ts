export function isImageType(contentType: string): boolean {
	return /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)$/.test(normalizeContentType(contentType));
}

export function normalizeContentType(contentType: string): string {
	return contentType.split(';')[0].trim().toLowerCase();
}

export function attachmentPreviewKind(contentType: string): 'image' | 'audio' | 'video' | 'pdf' | 'text' | null {
	const type = normalizeContentType(contentType);
	if (isImageType(type)) return 'image';
	if (/^audio\/(?:mpeg|mp3|mp4|ogg|wav|x-wav|webm|flac|aac)$/.test(type)) return 'audio';
	if (/^video\/(?:mp4|webm|ogg|quicktime)$/.test(type)) return 'video';
	if (type === 'application/pdf') return 'pdf';
	if (type.startsWith('text/') || type === 'application/json') return 'text';
	return null;
}

export function isPreviewableInline(contentType: string): boolean {
	const kind = attachmentPreviewKind(contentType);
	return kind !== null && normalizeContentType(contentType) !== 'text/html';
}

export function attachmentHref(emailId: string, attachmentId: string, download = false): string {
	const base = `/api/mail/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
	return download ? `${base}?download=1` : base;
}

export function attachmentIcon(contentType: string): string {
	contentType = normalizeContentType(contentType);
	if (isImageType(contentType)) return 'image-line';
	if (contentType.startsWith('audio/')) return 'music-2-line';
	if (contentType.startsWith('video/')) return 'video-line';
	if (contentType === 'application/pdf') return 'file-pdf-line';
	if (contentType.startsWith('text/')) return 'file-text-line';
	if (contentType.includes('zip') || contentType.includes('compressed')) return 'file-zip-line';
	return 'file-3-line';
}

/** One byte range; media players use these requests to seek without reloading. */
export function parseByteRange(value: string | null, size: number): { start: number; end: number } | null {
	if (!value || size <= 0) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return null;
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
	return { start, end };
}

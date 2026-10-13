import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL, MAX_TOTAL_ATTACHMENT_BYTES } from '$lib/constants';
import type { OutboundAttachmentInput } from '$lib/types';

export function attachmentByteLength(base64: string): number {
	return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

/** Validate before sending to a provider or writing any attachment objects. */
export function validateAttachmentInputs(value: unknown): asserts value is OutboundAttachmentInput[] {
	if (!Array.isArray(value)) throw new Error('Attachments must be a list');
	if (value.length > MAX_ATTACHMENTS_PER_EMAIL) throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_EMAIL} attachments allowed`);
	let total = 0;
	for (const file of value) {
		if (!file || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 255 ||
			typeof file.type !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) ||
			typeof file.content !== 'string') {
			throw new Error('Invalid attachment filename, type, or content');
		}
		if (file.contentId !== undefined && (typeof file.contentId !== 'string' || !/^[^\s<>]{1,998}$/.test(file.contentId))) {
			throw new Error('Invalid attachment content ID');
		}
		if (file.disposition !== undefined && !['inline', 'attachment'].includes(file.disposition)) throw new Error('Invalid attachment disposition');
		const size = attachmentByteLength(file.content);
		if (size > MAX_ATTACHMENT_BYTES) throw new Error(`"${file.filename}" exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit`);
		if (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) {
			throw new Error('Invalid attachment content');
		}
		total += size;
	}
	if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Attachments exceed the total size limit');
}

export function fileContentType(file: { name: string; type: string }): string {
	if (file.type) return file.type;
	const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
		webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
		mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv', json: 'application/json' };
	return types[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

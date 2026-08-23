export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export function webhookBodyTooLarge(contentLength: string | null): boolean {
	if (!contentLength) return false;
	const bytes = Number(contentLength);
	return !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_WEBHOOK_BODY_BYTES;
}

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export function webhookBodyTooLarge(contentLength: string | null): boolean {
	if (!contentLength) return false;
	const bytes = Number(contentLength);
	return !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_WEBHOOK_BODY_BYTES;
}

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** Count bytes as they arrive, including chunked bodies without Content-Length. */
export async function readBoundedBody(
	stream: ReadableStream<Uint8Array> | null,
	limit: number
): Promise<Uint8Array<ArrayBuffer>> {
	if (!stream) return new Uint8Array();
	const reader = stream.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new Error('Request body too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export const MAX_SIGNATURE_ASSET_BYTES = 512 * 1024;
export const MAX_SIGNATURE_ASSETS_PER_USER = 20;

const ALLOWED_TYPES: Record<string, string> = {
	'image/jpeg': 'image/jpeg',
	'image/jpg': 'image/jpeg',
	'image/png': 'image/png',
	'image/webp': 'image/webp',
	'image/gif': 'image/gif'
};

export type SignatureAsset = {
	id: string;
	user_id: string;
	content_type: string;
	byte_size: number;
	created_at: string;
};

export function signatureAssetKey(userId: string, assetId: string): string {
	return `signatures/${userId}/${assetId}`;
}

export function sniffSignatureImageType(bytes: Uint8Array): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return 'image/png';
	}
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return 'image/gif';
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

export function normalizeSignatureContentType(value: string): string | null {
	return ALLOWED_TYPES[value.toLowerCase()] ?? null;
}

export async function countSignatureAssets(db: D1Database, userId: string): Promise<number> {
	const row = await db
		.prepare('SELECT COUNT(*) AS n FROM signature_assets WHERE user_id = ?')
		.bind(userId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

export async function insertSignatureAsset(
	db: D1Database,
	bucket: R2Bucket,
	userId: string,
	bytes: Uint8Array,
	contentType: string
): Promise<SignatureAsset> {
	if (bytes.byteLength === 0) {
		throw new Error('Image is empty');
	}
	if (bytes.byteLength > MAX_SIGNATURE_ASSET_BYTES) {
		throw new Error('Image must be 512KB or smaller');
	}

	const sniffed = sniffSignatureImageType(bytes);
	const type = sniffed ?? normalizeSignatureContentType(contentType);
	if (!type) {
		throw new Error('Use a JPEG, PNG, WebP, or GIF image');
	}

	const existing = await countSignatureAssets(db, userId);
	if (existing >= MAX_SIGNATURE_ASSETS_PER_USER) {
		throw new Error('Too many signature images. Remove one first.');
	}

	const id = crypto.randomUUID();
	const key = signatureAssetKey(userId, id);
	await bucket.put(key, bytes, { httpMetadata: { contentType: type } });

	const createdAt = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO signature_assets (id, user_id, content_type, byte_size, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.bind(id, userId, type, bytes.byteLength, createdAt)
		.run();

	return { id, user_id: userId, content_type: type, byte_size: bytes.byteLength, created_at: createdAt };
}

export async function getSignatureAsset(
	db: D1Database,
	assetId: string
): Promise<SignatureAsset | null> {
	return (
		(await db
			.prepare(
				`SELECT id, user_id, content_type, byte_size, created_at
				 FROM signature_assets WHERE id = ?`
			)
			.bind(assetId)
			.first<SignatureAsset>()) ?? null
	);
}

export async function deleteSignatureAsset(
	db: D1Database,
	bucket: R2Bucket,
	userId: string,
	assetId: string
): Promise<boolean> {
	const asset = await getSignatureAsset(db, assetId);
	if (!asset || asset.user_id !== userId) return false;
	await bucket.delete(signatureAssetKey(userId, assetId));
	await db.prepare('DELETE FROM signature_assets WHERE id = ? AND user_id = ?').bind(assetId, userId).run();
	return true;
}

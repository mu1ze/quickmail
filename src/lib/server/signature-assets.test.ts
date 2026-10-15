import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { insertSignatureAsset, sniffSignatureImageType } from './signature-assets';

describe('signature asset sniffing', () => {
	test('recognizes JPEG, PNG, GIF, and WebP magic bytes', () => {
		assert.equal(sniffSignatureImageType(Uint8Array.of(0xff, 0xd8, 0xff, 0x00)), 'image/jpeg');
		assert.equal(
			sniffSignatureImageType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
			'image/png'
		);
		assert.equal(sniffSignatureImageType(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif');
		const webp = new Uint8Array(12);
		webp.set([0x52, 0x49, 0x46, 0x46], 0);
		webp.set([0x57, 0x45, 0x42, 0x50], 8);
		assert.equal(sniffSignatureImageType(webp), 'image/webp');
	});

	test('rejects non-image bytes', () => {
		assert.equal(sniffSignatureImageType(Uint8Array.of(0x00, 0x00, 0x00, 0x00)), null);
		assert.equal(sniffSignatureImageType(new Uint8Array(0)), null);
	});
});

describe('signature asset storage', () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
	const bucket = { put: async () => undefined } as unknown as import('@cloudflare/workers-types').R2Bucket;

	function fakeDb(hasHashColumn: boolean) {
		const rows: Record<string, unknown>[] = [];
		const db = {
			prepare(sql: string) {
				let values: unknown[] = [];
				return {
					bind(...args: unknown[]) { values = args; return this; },
					async first() {
						if (sql.includes('COUNT(*)')) return { n: rows.length };
						if (sql.includes('sha256')) {
							if (!hasHashColumn) throw new Error('no such column: sha256');
							return rows.find((row) => row.user_id === values[0] && row.sha256 === values[1]) ?? null;
						}
						return null;
					},
					async run() {
						if (sql.includes('sha256') && !hasHashColumn) throw new Error('no such column: sha256');
						const [id, user_id, content_type, byte_size, created_at, sha256] = values;
						rows.push({ id, user_id, content_type, byte_size, created_at, sha256 });
						return {};
					}
				};
			}
		} as unknown as import('@cloudflare/workers-types').D1Database;
		return { db, rows };
	}

	test('identical bytes reuse the stored image for the same account only', async () => {
		const { db, rows } = fakeDb(true);
		const first = await insertSignatureAsset(db, bucket, 'u1', png, 'image/png');
		const again = await insertSignatureAsset(db, bucket, 'u1', png, 'image/png');
		const other = await insertSignatureAsset(db, bucket, 'u2', png, 'image/png');
		assert.equal(again.id, first.id);
		assert.notEqual(other.id, first.id);
		assert.equal(rows.length, 2);
	});

	test('uploads still work before the hash column exists', async () => {
		const { db, rows } = fakeDb(false);
		await insertSignatureAsset(db, bucket, 'u1', png, 'image/png');
		await insertSignatureAsset(db, bucket, 'u1', png, 'image/png');
		assert.equal(rows.length, 2);
	});
});

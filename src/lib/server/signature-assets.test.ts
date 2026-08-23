import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sniffSignatureImageType } from './signature-assets';

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

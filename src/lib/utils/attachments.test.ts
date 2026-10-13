import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentHref, attachmentPreviewKind, isPreviewableInline, parseByteRange } from './attachments';

describe('attachment previews and media ranges', () => {
	test('classifies media and normalizes MIME parameters', () => {
		assert.equal(attachmentPreviewKind('IMAGE/JPEG; name=photo.jpg'), 'image');
		assert.equal(attachmentPreviewKind('audio/mpeg'), 'audio');
		assert.equal(attachmentPreviewKind('video/mp4'), 'video');
		assert.equal(attachmentPreviewKind('application/pdf'), 'pdf');
		assert.equal(attachmentPreviewKind('application/zip'), null);
	});
	test('never opens active HTML or SVG attachments at the app origin', () => {
		assert.equal(isPreviewableInline('text/html'), false);
		assert.equal(isPreviewableInline('image/svg+xml'), false);
		assert.equal(attachmentPreviewKind('image/svg+xml'), null);
	});
	test('encodes attachment paths', () => {
		assert.equal(attachmentHref('a/b', 'a?b', true), '/api/mail/a%2Fb/attachments/a%3Fb?download=1');
	});
	test('supports seeking, open ends, suffixes, and clamped ends', () => {
		assert.deepEqual(parseByteRange('bytes=2-4', 10), { start: 2, end: 4 });
		assert.deepEqual(parseByteRange('bytes=5-', 10), { start: 5, end: 9 });
		assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
		assert.deepEqual(parseByteRange('bytes=0-100', 10), { start: 0, end: 9 });
	});
	test('rejects invalid and unsatisfiable ranges', () => {
		for (const range of ['bytes=10-', 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=1-2,5-6', 'items=0-1']) {
			assert.equal(parseByteRange(range, 10), null);
		}
		assert.equal(parseByteRange('bytes=0-', 0), null);
	});
});

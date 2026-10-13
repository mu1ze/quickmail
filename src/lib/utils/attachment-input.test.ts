import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentByteLength, fileContentType, validateAttachmentInputs } from './attachment-input';
import { MAX_ATTACHMENT_BYTES } from '$lib/constants';

describe('attachment validation', () => {
	const file = { filename: 'photo.png', type: 'image/png', content: 'aGVsbG8=' };
	test('accepts valid files and calculates padded base64 sizes', () => {
		assert.doesNotThrow(() => validateAttachmentInputs([file]));
		assert.equal(attachmentByteLength(file.content), 5);
	});
	test('rejects malformed inputs before provider delivery', () => {
		for (const invalid of [null, {}, [{ ...file, content: '??' }], [{ ...file, type: 'text/html\r\nInjected' }], Array(6).fill(file)]) {
			assert.throws(() => validateAttachmentInputs(invalid));
		}
	});
	test('rejects an individually oversized file', () => {
		assert.throws(() => validateAttachmentInputs([{ ...file, content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64') }]), /exceeds/);
	});
	test('infers common media types when the browser provides none', () => {
		assert.equal(fileContentType({ name: 'PHOTO.JPG', type: '' }), 'image/jpeg');
		assert.equal(fileContentType({ name: 'recording.mp3', type: '' }), 'audio/mpeg');
		assert.equal(fileContentType({ name: 'unknown', type: '' }), 'application/octet-stream');
	});
});

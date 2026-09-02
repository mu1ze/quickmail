import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildMessagePreview, htmlToPreviewText } from './message-preview';

describe('message previews', () => {
	test('plain text is collapsed to a single readable line', () => {
		assert.equal(buildMessagePreview('Hello\n\nthere.'), 'Hello there.');
	});

	test('HTML-only mail becomes readable words, not tags', () => {
		const html = '<html><body><p>Your receipt is ready.</p><p>Total: $12</p></body></html>';
		assert.equal(buildMessagePreview(html), 'Your receipt is ready. Total: $12');
	});

	test('style and script blocks are dropped', () => {
		assert.equal(
			htmlToPreviewText('<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>'),
			'Hello'
		);
	});

	test('quoted history is not used as the snippet', () => {
		assert.equal(
			buildMessagePreview('Sounds good.\n\nOn Tue, someone@example.com wrote:\n> old'),
			'Sounds good.'
		);
	});

	test('empty bodies stay empty', () => {
		assert.equal(buildMessagePreview(null), '');
		assert.equal(buildMessagePreview(''), '');
	});
});

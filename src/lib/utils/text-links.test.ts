import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { textParts } from './text-links';

describe('plain text message links', () => {
	test('makes URLs and email addresses usable without interpreting markup', () => {
		assert.deepEqual(textParts('<script>Read https://example.com/docs, or email ada@example.com.</script>'), [
			{ text: '<script>Read ' }, { text: 'https://example.com/docs', href: 'https://example.com/docs' },
			{ text: ', or email ' }, { text: 'ada@example.com', href: 'mailto:ada@example.com' }, { text: '.</script>' }
		]);
	});
	test('keeps punctuation and newlines while handling parentheses in URLs', () => {
		const text = 'See (https://example.com/wiki/A_(B)).\nThanks.';
		const parts = textParts(text);
		assert.equal(parts.map((part) => part.text).join(''), text);
		assert.equal(parts.find((part) => part.href)?.href, 'https://example.com/wiki/A_(B)');
	});
});

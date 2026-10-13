import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToPlainText, isHtmlEmpty } from './html';

describe('server-rendered compose content', () => {
	test('does not require a browser parser and preserves paragraph boundaries', () => {
		assert.equal(htmlToPlainText('<p>First line</p><p>Second<br>Third</p>'), 'First line\nSecond\nThird');
	});
	test('ignores non-message content and accepts media-only bodies', () => {
		assert.equal(isHtmlEmpty('<style>p{color:red}</style><p><br></p>'), true);
		assert.equal(isHtmlEmpty('<IMG src="cid:photo">'), false);
		assert.equal(isHtmlEmpty('<video src="clip.mp4"></video>'), false);
	});
});

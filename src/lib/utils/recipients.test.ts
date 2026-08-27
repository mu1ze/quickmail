import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildReplyRecipients, parseRecipientList } from './recipients';

describe('recipient lists', () => {
	test('splits comma-separated addresses and drops duplicates', () => {
		assert.deepEqual(parseRecipientList('ada@example.com, bob@example.com, ada@example.com'), [
			'ada@example.com',
			'bob@example.com'
		]);
		assert.deepEqual(parseRecipientList('not-an-address,  , c@d.co'), ['c@d.co']);
	});

	test('reply goes only to the other party', () => {
		assert.deepEqual(
			buildReplyRecipients({
				direction: 'inbound',
				from: 'alice@work.com',
				to: 'me@mail.com',
				cc: 'bob@work.com',
				self: 'me@mail.com',
				mode: 'reply'
			}),
			{ to: 'alice@work.com', cc: '' }
		);
	});

	test('reply-all copies other recipients except ourselves', () => {
		assert.deepEqual(
			buildReplyRecipients({
				direction: 'inbound',
				from: 'alice@work.com',
				to: 'me@mail.com, team@work.com',
				cc: 'bob@work.com, me@mail.com',
				self: 'me@mail.com',
				mode: 'replyAll'
			}),
			{ to: 'alice@work.com', cc: 'team@work.com, bob@work.com' }
		);
	});

	test('replying to sent mail keeps the original To', () => {
		assert.deepEqual(
			buildReplyRecipients({
				direction: 'outbound',
				from: 'me@mail.com',
				to: 'alice@work.com',
				cc: 'bob@work.com',
				self: 'me@mail.com',
				mode: 'replyAll'
			}),
			{ to: 'alice@work.com', cc: 'bob@work.com' }
		);
	});
});

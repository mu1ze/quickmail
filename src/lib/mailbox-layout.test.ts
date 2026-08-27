import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseMailboxLayout } from './mailbox-layout';

describe('mailbox layout preference', () => {
	test('only list and cards are valid', () => {
		assert.equal(parseMailboxLayout('list'), 'list');
		assert.equal(parseMailboxLayout('cards'), 'cards');
		assert.equal(parseMailboxLayout(null), 'cards');
		assert.equal(parseMailboxLayout('grid'), 'cards');
	});
});

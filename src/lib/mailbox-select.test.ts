import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { handleMailboxRowClick, toggleSelection } from './mailbox-select';

describe('mailbox select mode', () => {
	test('row clicks open the thread when Select is off', () => {
		let prevented = false;
		const action = handleMailboxRowClick(false, () => {
			prevented = true;
		});
		assert.equal(action, 'open');
		assert.equal(prevented, false);
	});

	test('row clicks toggle instead of navigating when Select is on', () => {
		let prevented = false;
		const action = handleMailboxRowClick(true, () => {
			prevented = true;
		});
		assert.equal(action, 'toggle');
		assert.equal(prevented, true);
	});

	test('toggleSelection adds and removes a thread id', () => {
		assert.deepEqual(toggleSelection([], 'm1'), ['m1']);
		assert.deepEqual(toggleSelection(['m1', 'm2'], 'm1'), ['m2']);
	});
});

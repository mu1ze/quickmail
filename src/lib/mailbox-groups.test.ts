import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mailboxGroupHeadings, mailboxGroupLabel } from './mailbox-groups';

// Local wall-clock times, so the buckets hold in any timezone the tests run in.
const now = new Date(2026, 9, 14, 12, 0);
const at = (year: number, month: number, day: number, hour = 9) => ({
	created_at: new Date(year, month, day, hour).toISOString(),
	is_pinned: 0
});

describe('mailbox date groups', () => {
	test('recent mail falls into day buckets', () => {
		assert.equal(mailboxGroupLabel(at(2026, 9, 14, 0), now), 'Today');
		assert.equal(mailboxGroupLabel(at(2026, 9, 13, 23), now), 'Yesterday');
		assert.equal(mailboxGroupLabel(at(2026, 9, 9), now), 'Previous 7 days');
		assert.equal(mailboxGroupLabel(at(2026, 9, 2), now), 'Earlier this month');
	});

	test('older mail is grouped by month, with the year once it changes', () => {
		assert.equal(mailboxGroupLabel(at(2026, 7, 20), now), new Date(2026, 7, 20).toLocaleDateString([], { month: 'long' }));
		assert.match(mailboxGroupLabel(at(2025, 11, 3), now), /2025/);
	});

	test('pinned threads sit together regardless of date', () => {
		assert.equal(mailboxGroupLabel({ ...at(2024, 0, 1), is_pinned: 1 }, now), 'Pinned');
		assert.equal(mailboxGroupLabel({ created_at: 'broken', is_pinned: 0 }, now), 'Older');
	});

	test('a heading appears only where the group changes', () => {
		const threads = [
			{ ...at(2026, 8, 1), is_pinned: 1 },
			at(2026, 9, 14, 11),
			at(2026, 9, 14, 8),
			at(2026, 9, 13),
			at(2026, 9, 12)
		];
		assert.deepEqual(mailboxGroupHeadings(threads, now), ['Pinned', 'Today', null, 'Yesterday', 'Previous 7 days']);
	});
});

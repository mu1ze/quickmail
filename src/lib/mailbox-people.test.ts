import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { threadHeadline } from './mailbox-people';
import type { ThreadSummary } from './types';

function thread(participants: ThreadSummary['participants']): ThreadSummary {
	return {
		thread_id: 't1',
		latest_id: 'm1',
		subject: 'Hello',
		preview: 'Hi',
		participants,
		message_count: 1,
		is_read: true,
		is_starred: false,
		is_pinned: false,
		is_draft: false,
		has_attachments: false,
		domain_id: null,
		status: null,
		snoozed_until: null,
		auto_trashed: false,
		created_at: '2026-09-02 12:00:00'
	};
}

describe('mailbox row headline', () => {
	test('inbox shows the sender email, not a guessed display name', () => {
		assert.equal(
			threadHeadline(
				thread([{ label: 'charles', address: 'charles@example.com', self: false }]),
				'inbox'
			),
			'charles@example.com'
		);
	});

	test('sent and drafts show the recipient email', () => {
		assert.equal(
			threadHeadline(thread([{ label: 'me', address: 'ada@example.com', self: true }]), 'sent'),
			'ada@example.com'
		);
		assert.equal(
			threadHeadline(
				thread([
					{ label: 'me', address: 'ada@example.com', self: true },
					{ label: 'michael', address: 'michael@example.com', self: false }
				]),
				'sent'
			),
			'michael@example.com'
		);
	});
});

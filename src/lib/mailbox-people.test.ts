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
	test('prefers the stored sender name and keeps the address as a fallback', () => {
		assert.equal(threadHeadline(thread([{ label: 'hello', name: 'Paystack', address: 'hello@m.paystack.com', self: false }]), 'inbox'), 'Paystack');
		assert.equal(threadHeadline(thread([{ label: 'uber', name: 'Uber', address: 'uber@uber.com', self: false }]), 'inbox'), 'Uber');
		assert.equal(threadHeadline(thread([{ label: 'hello', name: '  ', address: 'hello@example.com', self: false }]), 'inbox'), 'hello@example.com');
	});
	test('names multiple senders without including our own identity', () => {
		assert.equal(threadHeadline(thread([
			{ label: 'me', address: 'owner@example.com', self: true },
			{ label: 'alex', name: 'Alex Chen', address: 'alex@example.com', self: false },
			{ label: 'jo', name: 'Jo', address: 'jo@example.com', self: false }
		]), 'inbox'), 'Alex Chen, Jo');
	});
	test('shows a sender-supplied display name without guessing one from the address', () => {
		assert.equal(threadHeadline(thread([{ label: 'guess', address: '"Alex Chen" <alex@example.com>', self: false }]), 'inbox'), 'Alex Chen');
		assert.equal(threadHeadline(thread([{ label: 'guess', address: 'alex@example.com', self: false }]), 'inbox'), 'alex@example.com');
	});
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

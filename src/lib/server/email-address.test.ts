import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseEmailAddress, visibleInboundFrom } from './email-address';

describe('visibleInboundFrom', () => {
	test('prefers the RFC 5322 From header over a VERP envelope sender', () => {
		assert.equal(
			visibleInboundFrom(
				'bounces+7856094-006a-muiz=dvlli.com@em306.m.paystack.com',
				'Paystack <hello@paystack.com>'
			),
			'hello@paystack.com'
		);
	});

	test('uses a bare header address when there is no display name', () => {
		assert.equal(
			visibleInboundFrom('bounces@em.example.com', 'billing@example.com'),
			'billing@example.com'
		);
	});

	test('falls back to the envelope sender when From is missing', () => {
		assert.equal(
			visibleInboundFrom('sender@example.com', null),
			'sender@example.com'
		);
		assert.equal(visibleInboundFrom('Ada <ada@example.com>', ''), 'ada@example.com');
	});

	test('ignores a header that is not an address', () => {
		assert.equal(visibleInboundFrom('mailer@example.com', 'undisclosed'), 'mailer@example.com');
	});
});

describe('parseEmailAddress', () => {
	test('extracts the address from angle brackets', () => {
		assert.equal(parseEmailAddress('Paystack <Hello@Paystack.com>'), 'hello@paystack.com');
	});
});

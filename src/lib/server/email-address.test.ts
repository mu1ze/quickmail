import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseEmailAddress, senderDisplayName, visibleInboundFrom } from './email-address';

describe('senderDisplayName', () => {
	test('preserves a supplied name while matching the actual From address', () => {
		assert.equal(senderDisplayName('Paystack <Hello@M.Paystack.com>', 'hello@m.paystack.com'), 'Paystack');
		assert.equal(senderDisplayName('"Chen, Alex" <alex@example.com>', 'alex@example.com'), 'Chen, Alex');
		assert.equal(senderDisplayName('Paystack <hello@paystack.com>', 'bounce@paystack.com'), null);
	});
	test('decodes MIME names and leaves unnamed senders unnamed', () => {
		assert.equal(senderDisplayName('=?UTF-8?Q?Jos=C3=A9?= <jose@example.com>', 'jose@example.com'), 'José');
		assert.equal(senderDisplayName('alex@example.com', 'alex@example.com'), null);
		assert.equal(senderDisplayName(null, 'alex@example.com'), null);
	});
});

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

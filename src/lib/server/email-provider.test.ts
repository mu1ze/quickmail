import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	isValidDomainName,
	looksLikeProviderId,
	normalizeDomainName,
	parseMailDomains
} from './email-provider';

describe('normalizeDomainName', () => {
	test('trims, lowercases, and strips a leading @ or trailing dot', () => {
		assert.equal(normalizeDomainName('  @Example.COM.  '), 'example.com');
	});
});

describe('isValidDomainName', () => {
	test('accepts typical hostnames', () => {
		assert.equal(isValidDomainName('example.com'), true);
		assert.equal(isValidDomainName('mail.example.co.uk'), true);
		assert.equal(isValidDomainName('my-domain.io'), true);
	});

	test('rejects empty, bare labels, IPs, and junk', () => {
		assert.equal(isValidDomainName(''), false);
		assert.equal(isValidDomainName('localhost'), false);
		assert.equal(isValidDomainName('example'), false);
		assert.equal(isValidDomainName('10.0.0.1'), false);
		assert.equal(isValidDomainName('not a domain'), false);
		assert.equal(isValidDomainName('-bad.com'), false);
	});
});

describe('looksLikeProviderId', () => {
	test('detects Resend-style UUIDs and ignores hostnames', () => {
		assert.equal(looksLikeProviderId('4dd369bc-aa82-4ff3-97de-514ae3000ee0'), true);
		assert.equal(looksLikeProviderId('example.com'), false);
	});
});

describe('parseMailDomains', () => {
	test('splits, normalizes, and de-duplicates', () => {
		assert.deepEqual(parseMailDomains('Example.com, @mail.example.com, example.com'), [
			'example.com',
			'mail.example.com'
		]);
	});
});

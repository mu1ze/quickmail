import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildForwardBody, withForwardPrefix } from './forward';

describe('forward compose', () => {
	test('adds a single Fwd prefix', () => {
		assert.equal(withForwardPrefix('Lunch'), 'Fwd: Lunch');
		assert.equal(withForwardPrefix('Fwd: Lunch'), 'Fwd: Lunch');
		assert.equal(withForwardPrefix('FW: Lunch'), 'FW: Lunch');
		assert.equal(withForwardPrefix(''), 'Fwd: (no subject)');
	});

	test('quotes the original headers above the body', () => {
		const html = buildForwardBody({
			from: 'ada@example.com',
			to: 'me@mail.com',
			subject: 'Hello',
			date: '2026-08-27',
			bodyHtml: '<p>Hi</p>'
		});
		assert.match(html, /Forwarded message/);
		assert.match(html, /ada@example.com/);
		assert.match(html, /<p>Hi<\/p>/);
	});
});

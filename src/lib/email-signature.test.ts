import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appendEmailSignature,
	defaultComposeSignatureId,
	MAX_EMAIL_SIGNATURE_LENGTH,
	MAX_SIGNATURE_NAME_LENGTH,
	normalizeEmailSignature,
	parseMailboxSignature,
	parseSignatureName,
	pickEmailSignature,
	resolveSignatureBody
} from './email-signature';

	describe('email signatures', () => {
	test('normalizes line endings and trailing whitespace', () => {
		assert.equal(
			normalizeEmailSignature('  Best,  \r\nEmmanuel  \r\n'),
			'Best,\nEmmanuel'
		);
	});

	test('appends a sign-off to plain text and HTML', () => {
		assert.deepEqual(
			appendEmailSignature({
				text: 'Hello there',
				html: '<p>Hello there</p>',
				signature: 'Best,\nEmmanuel'
			}),
			{
				text: 'Hello there\n\nBest,\nEmmanuel',
				html:
					'<p>Hello there</p>\n<div><br></div>\n<div data-email-signature="true">Best,<br>\nEmmanuel</div>'
			}
		);
	});

	test('escapes signature text before adding it to HTML', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<p>Hello</p>',
			signature: '<Emmanuel & Co>'
		});

		assert.match(result.html ?? '', /&lt;Emmanuel &amp; Co&gt;/);
		assert.doesNotMatch(result.html ?? '', /<Emmanuel & Co>/);
	});

	test('leaves the message unchanged when the signature is empty', () => {
		assert.deepEqual(
			appendEmailSignature({ text: 'Hello', html: '<p>Hello</p>', signature: '   ' }),
			{ text: 'Hello', html: '<p>Hello</p>' }
		);
	});

	test('picks a mailbox signature over the account signature', () => {
		assert.equal(pickEmailSignature('Support', 'Best,\nEmmanuel'), 'Support');
		assert.equal(pickEmailSignature('  ', 'Best,\nEmmanuel'), 'Best,\nEmmanuel');
		assert.equal(pickEmailSignature(null, ''), '');
	});

	test('appends compiled template HTML without escaping the markup', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<p>Hello</p>',
			signature: JSON.stringify({
				version: 1,
				layout: 'stacked',
				name: 'Ada <Corp>',
				title: 'Engineer',
				company: '',
				phone: '',
				website: '',
				accent: '#111111',
				photoId: null,
				logoId: null,
				socials: [],
				text: ''
			})
		});
		assert.match(result.html ?? '', /<table role="presentation"/);
		assert.match(result.html ?? '', /Ada &lt;Corp&gt;/);
		assert.match(result.text ?? '', /Ada <Corp>/);
	});

	test('rejects mailbox signatures over the character limit', () => {
		assert.equal(parseMailboxSignature('  Best  '), 'Best');
		assert.equal(parseMailboxSignature('   '), null);
		assert.equal(parseMailboxSignature('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH))?.length, 4000);
		assert.throws(
			() => parseMailboxSignature('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH + 1)),
			/4000 characters or fewer/
		);
	});

	test('rewrites hosted photos to absolute URLs when an origin is provided', () => {
		const photoId = '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f';
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<p>Hello</p>',
			origin: 'https://mail.example.com',
			signature: JSON.stringify({
				version: 1,
				layout: 'photo',
				name: 'Ada',
				title: '',
				company: '',
				phone: '',
				website: '',
				accent: '#111111',
				photoId,
				logoId: null,
				socials: [],
				text: ''
			})
		});
		assert.match(result.html ?? '', new RegExp(`src="https://mail.example.com/s/${photoId}"`));
		assert.match(result.html ?? '', /data-email-signature="true"/);
	});

	test('picks a named signature over the mailbox fallback', () => {
		const signatures = [
			{ id: 'sig-work', name: 'Work', body: 'Work sign-off', is_default: true, position: 0 },
			{ id: 'sig-home', name: 'Home', body: 'Home sign-off', is_default: false, position: 1 }
		];
		assert.equal(
			resolveSignatureBody({ signatures, selectedId: 'sig-home' }),
			'Home sign-off'
		);
		assert.equal(resolveSignatureBody({ signatures, selectedId: '' }), '');
		assert.equal(
			resolveSignatureBody({
				signatures,
				mailboxSignatureId: 'sig-home',
				mailboxBody: 'Legacy'
			}),
			'Home sign-off'
		);
		assert.equal(
			resolveSignatureBody({ signatures, mailboxBody: 'Legacy' }),
			'Legacy'
		);
		assert.equal(defaultComposeSignatureId(signatures, 'sig-home'), 'sig-home');
		assert.equal(defaultComposeSignatureId(signatures), 'sig-work');
	});

	test('parses a signature name', () => {
		assert.equal(parseSignatureName('  Work  '), 'Work');
		assert.equal(parseSignatureName(''), 'Signature');
		assert.equal(parseSignatureName('x'.repeat(80)).length, MAX_SIGNATURE_NAME_LENGTH);
	});
});

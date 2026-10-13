import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildEmailDocument, hasRemoteContent } from './email-html';

describe('received email remote content', () => {
	test('detects remote HTML and CSS resources', () => {
		assert.equal(hasRemoteContent('<img src="https://track.example/pixel">'), true);
		assert.equal(hasRemoteContent('<style>body{background:url(//track.example/a)}</style>'), true);
		assert.equal(hasRemoteContent('<img src="cid:logo"><img src="data:image/png;base64,AA">'), false);
	});

	test('blocks remote resources by default', () => {
		const document = buildEmailDocument('<img src="https://track.example/pixel">', {
			rich: false
		});
		assert.match(document, /Content-Security-Policy/);
		assert.match(document, /img-src data: blob:/);
	});

	test('allows an explicit remote-content opt in', () => {
		const document = buildEmailDocument('<html><head></head><body></body></html>', {
			rich: true,
			allowRemote: true
		});
		assert.match(document, /Content-Security-Policy/);
		assert.match(document, /img-src data: blob: https: http:/);
		assert.match(document, /script-src 'none'/);
	});

	test('allows stored media only from this message while blocking remote images', () => {
		const document = buildEmailDocument('<img src="cid:photo">', {
			rich: false, localResourceBase: 'https://mail.example/api/mail/123/attachments/'
		});
		assert.match(document, /img-src data: blob: https:\/\/mail.example\/api\/mail\/123\/attachments\//);
		assert.doesNotMatch(document, /blob: https: http:/);
	});

	test('rejects a resource base that could inject CSP directives', () => {
		const document = buildEmailDocument('<p>Hello</p>', {
			rich: false, localResourceBase: "https://mail.example/; script-src *"
		});
		assert.doesNotMatch(document, /script-src \*/);
	});

	test('places the blocking policy before a complete document', () => {
		const document = buildEmailDocument(
			'<html><head><link rel="stylesheet" href="https://track.example/a.css"></head></html>',
			{ rich: true }
		);
		assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<link'));
	});
});

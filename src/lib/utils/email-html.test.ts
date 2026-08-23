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
		assert.doesNotMatch(document, /Content-Security-Policy/);
	});

	test('places the blocking policy before a complete document', () => {
		const document = buildEmailDocument(
			'<html><head><link rel="stylesheet" href="https://track.example/a.css"></head></html>',
			{ rich: true }
		);
		assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<link'));
	});
});

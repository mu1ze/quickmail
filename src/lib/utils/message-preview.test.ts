import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildMessagePreview, htmlToPreviewText, looksLikeHtml } from './message-preview';

describe('message previews', () => {
	test('uses original HTML instead of a text alternative polluted with CSS', () => {
		assert.equal(buildMessagePreview(
			"Your full transaction history is staying intact. a{ text-decoration:none !important; } Image Hello Muiz",
			"<style>a{ text-decoration:none !important; }</style><p>Your full transaction history is staying intact.</p><img alt=\"Image\"><p>Hello Muiz</p>"
		), 'Your full transaction history is staying intact. Hello Muiz');
	});
	test('cleans CSS from older flattened text without deleting nearby prose', () => {
		assert.equal(buildMessagePreview("Your full transaction history is staying intact. Here's what's changing in your Dashboard & API. a{ text-decoration:none !important; } Hello Muiz"), "Your full transaction history is staying intact. Here's what's changing in your Dashboard & API. Hello Muiz");
		assert.equal(buildMessagePreview('.hero { color: red; } Your receipt is ready.'), 'Your receipt is ready.');
	});
	test('falls back to useful text when HTML is empty', () => {
		assert.equal(buildMessagePreview('Receipt attached.', '<html><body><img src="cid:receipt"></body></html>'), 'Receipt attached.');
		assert.equal(buildMessagePreview('Meet at {time: 5:00} and bring {your name}.'), 'Meet at {time: 5:00} and bring {your name}.');
	});
	test('reads content after long stylesheets instead of truncating the HTML first', () => {
		assert.equal(buildMessagePreview(`<html><head><style>${'.layout{color:red}'.repeat(400)}</style></head><body>Your flight is confirmed.</body></html>`), 'Your flight is confirmed.');
	});
	test('removes quoted HTML and attribution before flattening lines', () => {
		assert.equal(buildMessagePreview('<p>Sounds good.</p><p>On Tuesday, someone wrote:</p><blockquote>Old message</blockquote>'), 'Sounds good.');
	});
	test('decodes emoji entities without truncating Unicode code points', () => {
		assert.equal(buildMessagePreview('<p>Confirmed &#x1F44D; &#128640;</p>'), 'Confirmed 👍 🚀');
	});
	test('invalid Unicode entities cannot crash mailbox rendering', () => {
		assert.equal(buildMessagePreview('<p>Hello &#999999999;</p>'), 'Hello �');
	});
	test('plain text is collapsed to a single readable line', () => {
		assert.equal(buildMessagePreview('Hello\n\nthere.'), 'Hello there.');
	});

	test('HTML-only mail becomes readable words, not tags', () => {
		const html = '<html><body><p>Your receipt is ready.</p><p>Total: $12</p></body></html>';
		assert.equal(buildMessagePreview(html), 'Your receipt is ready. Total: $12');
	});

	test('style and script blocks are dropped', () => {
		assert.equal(
			htmlToPreviewText('<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>'),
			'Hello'
		);
	});

	test('quoted history is not used as the snippet', () => {
		assert.equal(
			buildMessagePreview('Sounds good.\n\nOn Tue, someone@example.com wrote:\n> old'),
			'Sounds good.'
		);
	});

	test('empty bodies stay empty', () => {
		assert.equal(buildMessagePreview(null), '');
		assert.equal(buildMessagePreview(''), '');
	});

	test('Outlook comments and leftover markup do not become the snippet', () => {
		const outlook =
			'<!-- body --> <!--[if (gte mso 9)|(IE)]> <![endif]--> <!--[if (gte mso 9)|(IE)]> <![endif]--> <!--[if (gte mso 9)|(IE)]> <![endif]--> H...';
		assert.equal(looksLikeHtml(outlook), true);
		assert.equal(buildMessagePreview(outlook), '');
	});

	test('a truncated style block is dropped instead of leaking CSS', () => {
		const truncated =
			'<html><head><style>body{margin:0} .hero{height:400px;background:#000} H';
		assert.equal(buildMessagePreview(truncated), '');
	});

	test('marketing HTML keeps the visible sentence, not comments or tracking URLs', () => {
		const html = `<!--[if mso]>
<table><tr><td>
<![endif]-->
<p>Niagara rentals are open for the season.</p>
<p>Book now (https://track.example/click?id=99)</p>
<!--[if mso]></td></tr></table><![endif]-->`;
		assert.equal(
			buildMessagePreview(html),
			'Niagara rentals are open for the season. Book now'
		);
	});

	test('unclosed head does not swallow body text', () => {
		const html =
			'<html><head><meta charset="utf-8"><body><p>Hello world this is the actual email body.</p>';
		assert.equal(
			buildMessagePreview(html),
			'Hello world this is the actual email body.'
		);
	});

	test('unclosed head with a closed style still keeps the body sentence', () => {
		const html =
			'<html><head><style>body{margin:0}</style><body><p>Niagara rentals are open for the season.</p>';
		assert.equal(buildMessagePreview(html), 'Niagara rentals are open for the season.');
	});

	test('unclosed style stops at body instead of swallowing the message', () => {
		const html =
			'<html><head><style>body{margin:0}<body><p>Hello world this is the actual email body.</p>';
		assert.equal(buildMessagePreview(html), 'Hello world this is the actual email body.');
	});

	test('short plain-text replies are kept', () => {
		assert.equal(buildMessagePreview('OK'), 'OK');
		assert.equal(buildMessagePreview('Hi'), 'Hi');
		assert.equal(buildMessagePreview('👍'), '👍');
		assert.equal(buildMessagePreview('Yes'), 'Yes');
	});

	test('plain text keeps placeholders and ordinary URLs', () => {
		assert.equal(
			buildMessagePreview('Please fill in {your name} before Friday so we can process this.'),
			'Please fill in {your name} before Friday so we can process this.'
		);
		assert.equal(
			buildMessagePreview('Read more at https://example.com/docs/start then reply.'),
			'Read more at https://example.com/docs/start then reply.'
		);
	});

	test('comparison operators in prose are not treated as tags', () => {
		const prose = 'swap if a<b otherwise leave it as-is.';
		assert.equal(looksLikeHtml(prose), false);
		assert.equal(buildMessagePreview(prose), prose);
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	compileSignature,
	isSignatureEmpty,
	parseSignatureConfig,
	sanitizeHttpUrl,
	serializeSignatureConfig,
	signatureAssetUrl
} from './signature-template';

describe('signature templates', () => {
	test('legacy plain text stays a plain sign-off', () => {
		const config = parseSignatureConfig('Best,\nEmmanuel');
		assert.equal(config.layout, 'plain');
		assert.equal(config.text, 'Best,\nEmmanuel');
		assert.equal(serializeSignatureConfig(config), 'Best,\nEmmanuel');
	});

	test('round-trips a stacked template as JSON', () => {
		const stored = serializeSignatureConfig({
			version: 1,
			layout: 'stacked',
			name: 'Ada Lovelace',
			title: 'Engineer',
			company: 'Analytical Engines',
			phone: '+1 555 0100',
			website: 'example.com',
			accent: '#0b6e4f',
			photoId: null,
			logoId: null,
			socials: [{ kind: 'linkedin', url: 'https://linkedin.com/in/ada' }],
			text: ''
		});
		assert.match(stored, /^\{/);
		const parsed = parseSignatureConfig(stored);
		assert.equal(parsed.layout, 'stacked');
		assert.equal(parsed.name, 'Ada Lovelace');
		assert.equal(parsed.website, 'https://example.com/');
		assert.equal(parsed.socials[0]?.kind, 'linkedin');
	});

	test('empty templates serialize to an empty string', () => {
		assert.equal(serializeSignatureConfig(parseSignatureConfig('')), '');
		assert.ok(isSignatureEmpty(parseSignatureConfig('   ')));
	});

	test('rejects javascript: URLs and unknown layouts', () => {
		assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
		assert.equal(sanitizeHttpUrl('https://ok.example'), 'https://ok.example/');
		const config = parseSignatureConfig(
			JSON.stringify({
				version: 1,
				layout: 'canvas',
				name: '<Ada>',
				website: 'javascript:alert(1)',
				socials: [{ kind: 'myspace', url: 'https://x.test' }]
			})
		);
		assert.equal(config.layout, 'stacked');
		assert.equal(config.website, '');
		assert.equal(config.socials.length, 0);
	});

	test('compiles stacked HTML with escaped fields and no flex/grid', () => {
		const { html, text } = compileSignature({
			version: 1,
			layout: 'stacked',
			name: 'Ada <Corp>',
			title: 'Engineer',
			company: 'AE',
			phone: '',
			website: 'https://ada.test',
			accent: '#123456',
			photoId: null,
			logoId: null,
			socials: [],
			text: ''
		});
		assert.match(html, /<table role="presentation"/);
		assert.match(html, /Ada &lt;Corp&gt;/);
		assert.doesNotMatch(html, /<Ada <Corp>>/);
		assert.doesNotMatch(html, /display:\s*flex/);
		assert.doesNotMatch(html, /<style/);
		assert.match(text, /Ada <Corp>/);
		assert.match(text, /https:\/\/ada\.test/);
	});

	test('photo layout points at the hosted asset URL', () => {
		const id = '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f';
		const { html } = compileSignature(
			{
				version: 1,
				layout: 'photo',
				name: 'Ada',
				title: '',
				company: '',
				phone: '',
				website: '',
				accent: '#111111',
				photoId: id,
				logoId: null,
				socials: [],
				text: ''
			},
			'https://mail.example.com'
		);
		assert.match(html, new RegExp(`src="https://mail.example.com/s/${id}"`));
		assert.match(html, /width="72"/);
		assert.equal(signatureAssetUrl('https://mail.example.com/', id), `https://mail.example.com/s/${id}`);
	});

	test('omits images when no origin is available', () => {
		const { html } = compileSignature({
			version: 1,
			layout: 'photo',
			name: 'Ada',
			title: '',
			company: '',
			phone: '',
			website: '',
			accent: '#111111',
			photoId: '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f',
			logoId: null,
			socials: [],
			text: ''
		});
		assert.doesNotMatch(html, /<img/);
		assert.match(html, /Ada/);
	});
});

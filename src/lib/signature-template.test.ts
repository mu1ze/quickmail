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
			animation: 'none',
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
			animation: 'none',
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
				animation: 'none',
				socials: [],
				text: ''
			},
			'https://mail.example.com'
		);
		assert.match(html, new RegExp(`src="https://mail.example.com/s/${id}"`));
		assert.match(html, /width="72"/);
		assert.equal(signatureAssetUrl('https://mail.example.com/', id), `https://mail.example.com/s/${id}`);
	});

	test('animates the photo with scoped, reduced-motion-safe CSS', () => {
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
				accent: '#0b6e4f',
				photoId: id,
				logoId: null,
				animation: 'float',
				socials: [],
				text: ''
			},
			'https://mail.example.com'
		);
		const cls = `qm-sig-float-${id.slice(0, 8)}`;
		assert.match(html, /<style>@keyframes qm-sig-float-/);
		assert.match(html, new RegExp(`<img class="${cls}"`));
		assert.match(html, new RegExp(`\\.${cls}\\{animation:`));
		assert.match(html, /prefers-reduced-motion:reduce/);
	});

	test('glow animation carries the sanitized accent into the drop-shadow', () => {
		const id = '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f';
		const { html } = compileSignature(
			{
				version: 1,
				layout: 'logo',
				name: 'Ada',
				title: '',
				company: '',
				phone: '',
				website: '',
				accent: '#0b6e4f',
				photoId: null,
				logoId: id,
				animation: 'glow',
				socials: [],
				text: ''
			},
			'https://mail.example.com'
		);
		assert.match(html, /drop-shadow\(0 0 6px #0b6e4f\)/);
	});

	test('renders an image-only signature (animated logo, no text)', () => {
		const id = '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f';
		const { html, text } = compileSignature(
			{
				version: 1,
				layout: 'logo',
				name: '',
				title: '',
				company: '',
				phone: '',
				website: '',
				accent: '#111111',
				photoId: null,
				logoId: id,
				animation: 'wave',
				socials: [],
				text: ''
			},
			'https://mail.example.com'
		);
		assert.match(html, new RegExp(`<img class="qm-sig-wave-${id.slice(0, 8)}"`));
		assert.match(html, new RegExp(`src="https://mail.example.com/s/${id}"`));
		assert.equal(text, '');
	});

	test('animation round-trips through serialize and parse', () => {
		const stored = serializeSignatureConfig({
			version: 1,
			layout: 'logo',
			name: 'Ada',
			title: '',
			company: '',
			phone: '',
			website: '',
			accent: '#111111',
			photoId: null,
			logoId: '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f',
			animation: 'spin',
			socials: [],
			text: ''
		});
		assert.equal(parseSignatureConfig(stored).animation, 'spin');
	});

	test('unknown animation values fall back to none (no style block)', () => {
		const id = '2f1a0c8e-4b3d-4a9f-8c1e-0a7b6d5c4e3f';
		const config = parseSignatureConfig(
			JSON.stringify({ version: 1, layout: 'logo', name: 'Ada', logoId: id, animation: 'explode' })
		);
		assert.equal(config.animation, 'none');
		const { html } = compileSignature(config, 'https://mail.example.com');
		assert.doesNotMatch(html, /<style/);
		assert.doesNotMatch(html, /class="qm-sig/);
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
			animation: 'none',
			socials: [],
			text: ''
		});
		assert.doesNotMatch(html, /<img/);
		assert.match(html, /Ada/);
	});
});

describe('signature effects', () => {
	const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
	const baked = (n: number, w = 88, h = 88) => ({ id: id(n), w, h, key: 'k' });
	const base = {
		version: 1 as const,
		layout: 'photo' as const,
		name: 'Ada Lovelace',
		photoId: id(1),
		animation: 'halo' as const
	};

	test('a baked animation replaces the still photo and its CSS', () => {
		const { html } = compileSignature(parseSignatureConfig(JSON.stringify({ ...base, motion: baked(2) })), 'https://mail.example');
		assert.match(html, new RegExp(`/s/${id(2)}`));
		assert.doesNotMatch(html, /<style>/);
		assert.doesNotMatch(html, new RegExp(`/s/${id(1)}`));
	});

	test('older signatures without a baked image keep the CSS fallback', () => {
		const { html } = compileSignature(parseSignatureConfig(JSON.stringify(base)), 'https://mail.example');
		assert.match(html, /@keyframes/);
		assert.match(html, new RegExp(`/s/${id(1)}`));
	});

	test('the handwritten name sits above the details with the name as alt text', () => {
		const config = parseSignatureConfig(JSON.stringify({ ...base, script: { enabled: true, font: 'allura', loop: false }, scriptImage: baked(3, 220, 60) }));
		const { html } = compileSignature(config, 'https://mail.example');
		assert.match(html, new RegExp(`<img src="https://mail.example/s/${id(3)}" width="220" height="60" alt="Ada Lovelace"`));
		assert.ok(html.indexOf(id(3)) < html.indexOf('>Ada Lovelace</div>'));
	});

	test('live availability links the status endpoint in mail and shows the current badge in preview', () => {
		const config = parseSignatureConfig(
			JSON.stringify({
				...base,
				live: { enabled: true, tz: 'UTC', start: 540, end: 1020, days: [1, 2, 3, 4, 5], city: '', oooFrom: '', oooTo: '' },
				liveImages: { available: baked(4, 160, 24), away: baked(5, 160, 24), ooo: baked(6, 160, 24) }
			})
		);
		const sent = compileSignature(config, 'https://mail.example').html;
		assert.match(sent, /src="https:\/\/mail\.example\/s\/status\?a=/);
		assert.doesNotMatch(sent, /[?&]v=/, 'no out-of-office range, so no out-of-office badge');
		const monday10 = new Date('2026-10-12T10:00:00Z');
		const sunday = new Date('2026-10-11T10:00:00Z');
		assert.match(compileSignature(config, '', { preview: true, now: monday10, assetUrl: (asset) => `blob:${asset}` }).html, new RegExp(`blob:${id(4)}`));
		assert.match(compileSignature(config, '', { preview: true, now: sunday, assetUrl: (asset) => `blob:${asset}` }).html, new RegExp(`blob:${id(5)}`));
	});

	test('bad effect data is dropped rather than emitted', () => {
		const config = parseSignatureConfig(
			JSON.stringify({ ...base, motion: { id: 'nope', w: 88, h: 88 }, live: { enabled: true, tz: 'Mars/Base', start: 'x' }, scriptImage: { id: id(7), w: 9000, h: 10 } })
		);
		assert.equal(config.motion, null);
		assert.equal(config.scriptImage, null);
		assert.equal(config.live.tz, 'UTC');
		assert.equal(config.live.start, 540);
	});
});

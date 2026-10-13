import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ProviderError } from '../email-provider';
import { createCloudflareProvider } from './cloudflare-provider';
import type { CloudflareSendPayload } from './cloudflare-provider';
import type { MailAddress } from '$lib/types';

const stubEmail = {
	async send() {
		return { messageId: 'cf-1' };
	}
};

describe('cloudflare provider domains', () => {
	test('keeps content IDs and inline disposition when forwarding an image', async () => {
		let payload: CloudflareSendPayload | null = null;
		const provider = createCloudflareProvider({ async send(input) { payload = input; return { messageId: 'cf-forward' }; } }, 'example.com');
		await provider.send({ from: { address: 'me@example.com' } as MailAddress, senderName: 'Me', to: 'you@example.com', subject: 'Forward', text: 'Photo',
			attachments: [{ filename: 'photo.png', type: 'image/png', content: 'aGVsbG8=', contentId: 'photo@sender' }] });
		const file = (payload as CloudflareSendPayload | null)?.attachments?.[0];
		assert.equal(file?.contentId, 'photo@sender');
		assert.equal(file?.disposition, 'inline');
		assert.equal(new TextDecoder().decode(file?.content as ArrayBuffer), 'hello');
	});
	test('lists only the configured seed domains', async () => {
		const provider = createCloudflareProvider(stubEmail, 'Example.com, other.test');
		const listed = await provider.listDomains();
		assert.deepEqual(
			listed.map((domain) => domain.id),
			['example.com', 'other.test']
		);
	});

	test('resolves a hostname that is not in CLOUDFLARE_MAIL_DOMAINS', async () => {
		const provider = createCloudflareProvider(stubEmail, 'seed.example');
		const domain = await provider.resolveDomain('New.Example.com');
		assert.deepEqual(domain, {
			id: 'new.example.com',
			name: 'new.example.com',
			status: 'verified',
			region: null,
			sendingEnabled: true,
			receivingEnabled: true
		});
	});

	test('rejects an invalid hostname', async () => {
		const provider = createCloudflareProvider(stubEmail, '');
		await assert.rejects(
			() => provider.resolveDomain('not a domain'),
			(error: unknown) => error instanceof ProviderError && error.code === 'invalid_domain'
		);
	});
});

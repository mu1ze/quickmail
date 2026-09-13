import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ProviderError } from '../email-provider';
import { createCloudflareProvider } from './cloudflare-provider';

const stubEmail = {
	async send() {
		return { messageId: 'cf-1' };
	}
};

describe('cloudflare provider domains', () => {
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

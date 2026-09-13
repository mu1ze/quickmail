import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { ProviderError } from '../email-provider';
import { createResendProvider } from './resend-provider';

type ResendDomain = {
	id: string;
	name: string;
	status: string;
	region: string;
	capabilities: { sending: 'enabled' | 'disabled'; receiving: 'enabled' | 'disabled' };
};

const existing: ResendDomain = {
	id: '4dd369bc-aa82-4ff3-97de-514ae3000ee0',
	name: 'already.test',
	status: 'verified',
	region: 'us-east-1',
	capabilities: { sending: 'enabled', receiving: 'enabled' }
};

let fetchImpl: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
	fetchImpl = null;
	globalThis.fetch = originalFetch;
});

function mockResend(handlers: {
	list?: ResendDomain[];
	get?: Record<string, ResendDomain>;
	created?: ResendDomain[];
}) {
	const created = handlers.created ?? [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method ?? 'GET').toUpperCase();
		if (fetchImpl) return fetchImpl(url, init);

		if (method === 'GET' && url.endsWith('/domains?limit=100')) {
			return json({ object: 'list', has_more: false, data: handlers.list ?? [] });
		}
		const getMatch = url.match(/\/domains\/([0-9a-f-]+)$/i);
		if (method === 'GET' && getMatch) {
			const domain = handlers.get?.[getMatch[1]];
			if (!domain) return json({ name: 'not_found', message: 'Domain not found' }, 404);
			return json(domain);
		}
		if (method === 'POST' && url.endsWith('/domains')) {
			const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
			const domain: ResendDomain = {
				id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
				name: body.name ?? 'created.test',
				status: 'not_started',
				region: 'us-east-1',
				capabilities: { sending: 'enabled', receiving: 'enabled' }
			};
			created.push(domain);
			return json(domain);
		}
		return json({ message: `unhandled ${method} ${url}` }, 500);
	}) as typeof fetch;
	return created;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('resend provider resolveDomain', () => {
	test('fetches by provider id', async () => {
		mockResend({ get: { [existing.id]: existing } });
		const domain = await createResendProvider('re_test').resolveDomain(existing.id);
		assert.equal(domain.id, existing.id);
		assert.equal(domain.name, 'already.test');
		assert.equal(domain.sendingEnabled, true);
	});

	test('connects an existing domain by hostname', async () => {
		const created = mockResend({
			list: [existing],
			get: { [existing.id]: existing }
		});
		const domain = await createResendProvider('re_test').resolveDomain('Already.TEST');
		assert.equal(domain.id, existing.id);
		assert.equal(created.length, 0);
	});

	test('creates a domain that Resend does not have yet', async () => {
		const created = mockResend({ list: [] });
		const domain = await createResendProvider('re_test').resolveDomain('brand-new.example');
		assert.equal(created.length, 1);
		assert.equal(created[0]?.name, 'brand-new.example');
		assert.equal(domain.name, 'brand-new.example');
		assert.equal(domain.status, 'not_started');
	});

	test('rejects an invalid hostname', async () => {
		mockResend({ list: [] });
		await assert.rejects(
			() => createResendProvider('re_test').resolveDomain('nope'),
			(error: unknown) => error instanceof ProviderError && error.code === 'invalid_domain'
		);
	});
});

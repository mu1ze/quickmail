import assert from 'node:assert/strict';
import { test } from 'node:test';
import { watchAccountSession } from './account-client';

test('browser guard binds same-origin requests, preserves fetch metadata and flags stale responses', async () => {
	const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const calls: { input: unknown; init?: RequestInit }[] = [];
	let stale = false;
	const nativeFetch = async (input: unknown, init?: RequestInit) => {
		calls.push({ input, init });
		return new Response('{}', { status: stale ? 409 : 200, headers: stale ? { 'X-QuickMail-Account-Changed': '1' } : {} });
	};
	const target = { fetch: nativeFetch, location: { href: 'https://mail.test/inbox', origin: 'https://mail.test' }, addEventListener() {}, removeEventListener() {} };
	Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
	Object.defineProperty(globalThis, 'document', { value: { addEventListener() {}, removeEventListener() {} }, configurable: true });
	let changed = 0;
	const stop = watchAccountSession('account-a', () => changed++);
	try {
		const controller = new AbortController();
		const options = { method: 'POST', body: '{}', credentials: 'same-origin' as const, signal: controller.signal };
		Object.defineProperty(options, '__sveltekit_fetch__', { value: true });
		await target.fetch('/api/drafts', options);
		assert.equal(new Headers(calls[0].init?.headers).get('X-QuickMail-Account'), 'account-a');
		assert.equal((calls[0].init as any).__sveltekit_fetch__, true);
		assert.equal(calls[0].init?.signal, controller.signal);
		assert.equal(calls[0].init?.body, '{}');
		await target.fetch('https://other.test/api/check');
		assert.equal(calls[1].init, undefined, 'never disclose the account id to another origin');
		stale = true;
		await target.fetch('/inbox/__data.json');
		assert.equal(changed, 1);
	} finally {
		stop();
		assert.equal(target.fetch, nativeFetch);
		if (beforeWindow) Object.defineProperty(globalThis, 'window', beforeWindow); else Reflect.deleteProperty(globalThis, 'window');
		if (beforeDocument) Object.defineProperty(globalThis, 'document', beforeDocument); else Reflect.deleteProperty(globalThis, 'document');
	}
});

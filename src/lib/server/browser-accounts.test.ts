import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { Database } from 'bun:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import { hashToken, createSessionToken } from './crypto';
import { getUserFromSession } from './auth';
import { ACCOUNTS_COOKIE, MAX_BROWSER_ACCOUNTS, browserSessions, readBrowserTokens, rememberBrowserAccount, signOutBrowserAccount, switchBrowserAccount } from './browser-accounts';
import { handle } from '../../hooks.server';
import { GET as listAccounts, POST as selectAccount } from '../../routes/api/auth/accounts/+server';

let sqlite: Database;
let db: D1Database;
let values: Map<string, string>;
let cookies: Pick<Cookies, 'get' | 'set' | 'delete'>;
let writes: { name: string; options: Parameters<Cookies['set']>[2] }[];
beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, is_admin INTEGER, created_at TEXT);
		CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT, expires_at TEXT);`);
	db = { prepare(sql: string) {
		let args: any[] = [];
		return { bind(...v: any[]) { args = v; return this; }, async first() { return sqlite.query(sql).get(...args); }, async run() { return sqlite.query(sql).run(...args); } };
	} } as unknown as D1Database;
	values = new Map(); writes = [];
	cookies = { get: (name) => values.get(name), set: (name, value, options) => { values.set(name, value); writes.push({ name, options }); }, delete: (name) => { values.delete(name); } };
});
afterEach(() => sqlite.close());

async function session(id: string, expires = new Date(Date.now() + 86_400_000).toISOString()) {
	sqlite.query('INSERT OR IGNORE INTO users VALUES (?, ?, ?, 0, ?)').run(id, `${id}@example.test`, id, new Date().toISOString());
	const token = createSessionToken();
	sqlite.query('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), id, await hashToken(token), expires);
	return { token, user: (await getUserFromSession(db, token))! };
}

test('adding B preserves a legacy A login; switching selects only a proven saved identity', async () => {
	const a = await session('a'); const b = await session('b'); const stranger = await session('stranger');
	values.set('mail_session', a.token); values.set('mail_domain', 'a-domain');
	assert.equal(await rememberBrowserAccount(db, cookies, b), true);
	assert.deepEqual((await browserSessions(db, cookies)).map((s) => s.user.id), ['b', 'a']);
	assert.equal(values.has('mail_domain'), false);
	assert.equal(await switchBrowserAccount(db, cookies, stranger.user.id), null);
	assert.equal(values.get('mail_session'), b.token);
	assert.equal((await switchBrowserAccount(db, cookies, 'a'))?.id, 'a');
	assert.equal(values.get('mail_session'), a.token);
	assert.ok(writes.every(({ options }) => options.httpOnly === true && options.secure === true && options.sameSite === 'lax'));
});

test('expired, revoked and malformed saved tokens cannot select an account', async () => {
	const a = await session('a'); const b = await session('b');
	await rememberBrowserAccount(db, cookies, a); await rememberBrowserAccount(db, cookies, b);
	sqlite.query('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 60_000).toISOString(), 'a');
	assert.equal(await switchBrowserAccount(db, cookies, 'a'), null, 'ISO expiration earlier today is expired');
	sqlite.query('DELETE FROM sessions WHERE user_id = ?').run('b');
	assert.deepEqual(await browserSessions(db, cookies), []);
	values.set(ACCOUNTS_COOKIE, '{invalid'); assert.doesNotThrow(() => readBrowserTokens(cookies));
	values.set(ACCOUNTS_COOKIE, JSON.stringify([null, {}, 'made-up-token'])); assert.deepEqual(readBrowserTokens(cookies), [b.token]);
});

test('signing out A falls back to B, keeps B valid and leaves another device signed in', async () => {
	const a = await session('a'); const b = await session('b'); const otherDevice = await session('a');
	await rememberBrowserAccount(db, cookies, b); await rememberBrowserAccount(db, cookies, a);
	assert.equal((await signOutBrowserAccount(db, cookies))?.id, 'b');
	assert.equal(await getUserFromSession(db, a.token), null);
	assert.equal((await getUserFromSession(db, otherDevice.token))?.id, 'a');
	assert.equal((await getUserFromSession(db, b.token))?.id, 'b');
	await signOutBrowserAccount(db, cookies, true);
	assert.equal(await getUserFromSession(db, b.token), null);
	assert.equal(values.has('mail_session'), false); assert.equal(values.has(ACCOUNTS_COOKIE), false);
});

test('re-adding an account replaces its saved session without duplicating it', async () => {
	const a = await session('a'); await rememberBrowserAccount(db, cookies, a);
	const replacement = await session('a'); await rememberBrowserAccount(db, cookies, replacement);
	assert.equal((await browserSessions(db, cookies)).length, 1);
	assert.equal(await getUserFromSession(db, a.token), null);
	assert.equal(values.get('mail_session'), replacement.token);
});

test('account limit rejects the new session without evicting saved accounts', async () => {
	for (let n = 0; n < MAX_BROWSER_ACCOUNTS; n++) assert.equal(await rememberBrowserAccount(db, cookies, await session(`u${n}`)), true);
	const previous = values.get('mail_session'); const extra = await session('extra');
	assert.equal(await rememberBrowserAccount(db, cookies, extra), false);
	assert.equal(await getUserFromSession(db, extra.token), null);
	assert.equal(values.get('mail_session'), previous);
	assert.equal((await browserSessions(db, cookies)).length, MAX_BROWSER_ACCOUNTS);
});

test('a stale tab cannot mutate or read under another active account', async () => {
	const a = await session('a'); const b = await session('b');
	await rememberBrowserAccount(db, cookies, a); await rememberBrowserAccount(db, cookies, b);
	for (const method of ['GET', 'POST']) {
		let resolved = false;
		const response = await handle({ event: {
			request: new Request('https://mail.test/api/drafts', { method, headers: { 'X-QuickMail-Account': 'a' } }),
			url: new URL('https://mail.test/api/drafts'), cookies, locals: {}, platform: { env: { DB: db } }
		} as any, resolve: async () => { resolved = true; return new Response('wrong account'); } });
		assert.equal(response.status, 409); assert.equal(response.headers.get('X-QuickMail-Account-Changed'), '1');
		assert.equal(resolved, false);
	}
});

test('account endpoints expose identities only and refuse unsaved identities, cross-origin changes and bearer keys', async () => {
	const a = await session('a'); await rememberBrowserAccount(db, cookies, a);
	const event = { cookies, platform: { env: { DB: db } }, locals: { authMethod: 'session' }, url: new URL('https://mail.test/api/auth/accounts') };
	const response = await listAccounts(event as any); const body = await response.text();
	assert.deepEqual(JSON.parse(body), { accounts: [{ id: 'a', name: 'a', email: 'a@example.test' }] });
	assert.equal(body.includes(a.token), false);
	assert.equal((await listAccounts({ ...event, locals: { authMethod: 'api_token' } } as any)).status, 401);
	for (const [origin, id, expected] of [['https://other.test', 'a', 403], ['https://mail.test', 'stranger', 401]] as const) {
		const selected = await selectAccount({ ...event, request: new Request(event.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }) } as any);
		assert.equal(selected.status, expected); assert.equal(values.get('mail_session'), a.token);
	}
});

/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import type { EmailProvider } from './email-provider';
import { sendAndStore } from './outbox';
import { handleCloudflareInbound } from './cloudflare-inbound';

let sqlite: Database;
let db: D1Database;
/** How many INSERT INTO emails statements to fail before letting writes through. */
let failEmailInserts = 0;
let sends: number;

const user: User = { id: 'owner', email: 'owner@example.com', name: 'Owner', is_admin: true, created_at: '2026-01-01T00:00:00.000Z' };
const bucket = (fail = false) => ({ put: async () => { if (fail) throw new Error('r2 down'); } }) as unknown as R2Bucket;
const provider: EmailProvider = {
	kind: 'cloudflare',
	async send() { sends++; return { providerId: `prov-${sends}` }; },
	async listDomains() { return []; }, async getDomain() { throw new Error('unused'); }, async resolveDomain() { throw new Error('unused'); }
};
const compose = { to: 'friend@example.org', subject: 'Hello', text: 'Hi there', includeSignature: false };
const sentRows = () => sqlite.query<{ provider_id: string }, []>("SELECT provider_id FROM emails WHERE direction='outbound'").all();

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	failEmailInserts = 0; sends = 0;
	db = {
		async batch(items: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try { const out = []; for (const item of items) out.push(await item.run()); sqlite.exec('COMMIT'); return out; }
			catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
		},
		prepare(sql: string) {
			let values: any[] = [];
			return {
				bind(...args: any[]) { values = args; return this; },
				async all() { return { results: sqlite.query(sql).all(...values) }; },
				async first() { return sqlite.query(sql).get(...values); },
				async run() {
					if (failEmailInserts > 0 && /^\s*INSERT INTO emails/i.test(sql)) { failEmailInserts--; throw new Error('d1 unavailable'); }
					return { meta: { changes: sqlite.query(sql).run(...values).changes } };
				}
			};
		}
	} as unknown as D1Database;
	sqlite.exec(`INSERT INTO users(id,email,name,password_hash,is_admin) VALUES('owner','owner@example.com','Owner','x',1);
		INSERT INTO domains(id,name,sending_enabled,receiving_enabled) VALUES('domain','example.com',1,1);
		INSERT INTO addresses(id,user_id,domain_id,address,is_default) VALUES('address','owner','domain','owner@example.com',1)`);
});
afterEach(() => sqlite.close());

test('a transient database failure after the provider accepted the mail is retried, not reported as a failed send', async () => {
	failEmailInserts = 2;
	const result = await sendAndStore({ DB: db, ATTACHMENTS: bucket() }, provider, user, compose);
	assert.equal(sends, 1, 'the message is sent exactly once');
	assert.ok(result.emailId);
	assert.deepEqual(result.warnings, []);
	assert.deepEqual(sentRows(), [{ provider_id: 'prov-1' }]);
});

test('if recording keeps failing the mail is still reported as sent, with a warning instead of an error', async () => {
	failEmailInserts = 99;
	const result = await sendAndStore({ DB: db, ATTACHMENTS: bucket() }, provider, user, compose);
	assert.equal(sends, 1);
	assert.equal(result.emailId, null);
	assert.equal(result.providerId, 'prov-1');
	assert.match(result.warnings[0], /was sent, but it could not be saved/i);
	assert.equal(sentRows().length, 0);
});

test('an attachment storage failure after sending is a warning, and the Sent record survives', async () => {
	const result = await sendAndStore({ DB: db, ATTACHMENTS: bucket(true) }, provider, user, {
		...compose, attachments: [{ filename: 'a.txt', type: 'text/plain', content: btoa('hello') }]
	});
	assert.ok(result.emailId);
	assert.match(result.warnings[0], /attachments could not be saved/i);
	assert.equal(sentRows().length, 1);
});

test('failures before the provider accepts the mail still throw and send nothing', async () => {
	await assert.rejects(() => sendAndStore({ DB: db, ATTACHMENTS: bucket() }, provider, user, { ...compose, to: '   ' }));
	assert.equal(sends, 0);
});

test('inbound mail the MIME parser rejects is stored as a plain-text fallback instead of being lost', async () => {
	const raw = 'From: Alex <alex@example.test>\r\nTo: owner@example.com\r\nSubject: Too much\r\nX-Big: ' + 'x'.repeat(2_300_000) + '\r\n\r\nThe actual message words.\r\n';
	await handleCloudflareInbound(
		{ from: 'alex@example.test', to: 'owner@example.com', headers: new Headers({ subject: 'Too much', from: 'Alex <alex@example.test>' }), raw: new Response(raw).body!, setReject() { throw new Error('must not reject'); } },
		{ DB: db, ATTACHMENTS: bucket() } as any
	);
	const row = sqlite.query<{ subject: string; body_text: string; from_addr: string }, []>("SELECT subject,body_text,from_addr FROM emails WHERE direction='inbound'").get()!;
	assert.equal(row.subject, 'Too much');
	assert.equal(row.from_addr, 'alex@example.test');
	assert.match(row.body_text, /could not be fully parsed/);
	assert.match(row.body_text, /The actual message words\./);
});

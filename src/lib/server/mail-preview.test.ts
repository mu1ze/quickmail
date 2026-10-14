/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { insertEmail, listMailbox, saveDraft } from './mail-store';

let sqlite: Database;
let db: D1Database;
let statements: string[];

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	statements = [];
	db = {
		async batch(items: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try { const out = []; for (const item of items) out.push(await item.run()); sqlite.exec('COMMIT'); return out; }
			catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
		},
		prepare(sql: string) {
			statements.push(sql);
			let values: any[] = [];
			return {
				bind(...args: any[]) { values = args; return this; },
				async all() { return { results: sqlite.query(sql).all(...values) }; },
				async first() { return sqlite.query(sql).get(...values); },
				async run() { return { meta: { changes: sqlite.query(sql).run(...values).changes } }; }
			};
		}
	} as unknown as D1Database;
	sqlite.exec("INSERT INTO users(id,email,name,password_hash) VALUES('owner','owner@example.com','Owner','disabled')");
});
afterEach(() => sqlite.close());

const receive = (bodyText: string | null, bodyHtml: string | null = null) =>
	insertEmail(db, { userId: 'owner', direction: 'inbound', from: 'a@example.com', to: 'owner@example.com', subject: 'Hi', bodyText, bodyHtml });
const stored = (id: string) => sqlite.query<{ preview: string | null }, [string]>('SELECT preview FROM emails WHERE id=?').get(id)!.preview;

test('preview is computed once at insert, from HTML when present', async () => {
	const id = await receive('plain fallback', '<style>p{color:red}</style><p>Hello <b>there</b></p>');
	assert.equal(stored(id), 'Hello there');
	assert.equal((await listMailbox(db, 'owner', { view: 'inbox' })).threads[0].preview, 'Hello there');
});

test('the list never reads message bodies once previews are stored', async () => {
	await receive('hello world', '<p>hello world</p>');
	statements.length = 0;
	await listMailbox(db, 'owner', { view: 'inbox' });
	assert.equal(statements.filter((sql) => /body_html|body_text/.test(sql)).length, 0);
});

test('legacy rows without a preview are filled lazily, then persisted', async () => {
	const id = await receive('legacy words here');
	sqlite.query('UPDATE emails SET preview = NULL WHERE id = ?').run(id);
	assert.equal((await listMailbox(db, 'owner', { view: 'inbox' })).threads[0].preview, 'legacy words here');
	assert.equal(stored(id), 'legacy words here');
	statements.length = 0;
	await listMailbox(db, 'owner', { view: 'inbox' });
	assert.equal(statements.filter((sql) => /body_html|body_text/.test(sql)).length, 0);
});

test('a message with no preview text stores an empty string so it is not recomputed', async () => {
	const id = await receive(null, null);
	assert.equal(stored(id), '');
});

test('saving a draft refreshes its preview', async () => {
	const id = await saveDraft(db, 'owner', { from: 'owner@example.com', to: 'b@example.com', subject: 'Draft', bodyText: 'first version' });
	assert.equal(stored(id), 'first version');
	await saveDraft(db, 'owner', { id, from: 'owner@example.com', to: 'b@example.com', subject: 'Draft', bodyText: 'second version' });
	assert.equal(stored(id), 'second version');
});

test('conversation lookups use the COALESCE(thread_id, id) index instead of scanning the account', () => {
	const plan = sqlite
		.query<{ detail: string }, []>(
			"EXPLAIN QUERY PLAN SELECT m.id FROM emails m WHERE m.user_id = 'owner' AND COALESCE(m.thread_id, m.id) IN ('a','b')"
		)
		.all()
		.map((row) => row.detail)
		.join('\n');
	assert.match(plan, /idx_emails_thread_coalesce \(user_id=\? AND <expr>=\?\)/);
});

/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { expandToThreads, getMailboxCounts, listMailbox, setEmailFlags } from './mail-store';
import { authorizeMailAction } from './api-access';
import { applyMailLabels, listMailLabels } from './mail-labels';

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	// Execute the production SQL against SQLite, as D1 does.
	db = {
		async batch(statements: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
			catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
		},
		prepare(sql: string) {
			let values: any[] = [];
			return {
				bind(...args: any[]) { values = args; return this; },
				async all() { return { results: sqlite.query(sql).all(...values) }; },
				async first() { return sqlite.query(sql).get(...values); },
				async run() { return { meta: { changes: sqlite.query(sql).run(...values).changes } }; }
			};
		}
	} as unknown as D1Database;
	sqlite.exec("INSERT INTO users(id,email,name,password_hash) VALUES('owner','owner@example.com','Owner','disabled'),('other','other@example.com','Other','disabled')");
	sqlite.exec(`INSERT INTO emails(id,user_id,direction,from_addr,to_addr,subject,body_text,thread_id) VALUES
		('received','owner','inbound','alex@example.com','owner@example.com','Project','Design notes','thread'),
		('reply','owner','outbound','owner@example.com','alex@example.com','Re: Project','Sounds good','thread'),
		('foreign','other','inbound','alex@example.com','other@example.com','Private','Secret','foreign')`);
});

afterEach(() => sqlite.close());

describe('mail folders', () => {
	test('archive preserves the conversation, sent mail and stars, and can be undone', async () => {
		const ids = await expandToThreads(db, 'owner', ['reply']);
		assert.deepEqual(ids.sort(), ['received', 'reply']);
		await setEmailFlags(db, 'owner', ids, { isArchived: true, isStarred: true });
		assert.equal((await listMailbox(db, 'owner', { view: 'inbox' })).total, 0);
		for (const view of ['all', 'sent', 'starred'] as const) {
			assert.equal((await listMailbox(db, 'owner', { view })).total, 1);
		}
		assert.equal((await getMailboxCounts(db, 'owner')).inbox_unread, 0);
		await setEmailFlags(db, 'owner', ids, { isArchived: false });
		assert.equal((await listMailbox(db, 'owner', { view: 'inbox' })).total, 1);
	});

	test('spam stays out of ordinary folders and can be returned to the inbox', async () => {
		const ids = await expandToThreads(db, 'owner', ['received']);
		await setEmailFlags(db, 'owner', ids, { isSpam: true, isStarred: true });
		for (const view of ['inbox', 'all', 'sent', 'starred'] as const) {
			assert.equal((await listMailbox(db, 'owner', { view })).total, 0);
		}
		assert.equal((await listMailbox(db, 'owner', { view: 'spam' })).total, 1);
		await setEmailFlags(db, 'owner', ids, { isSpam: false, isArchived: false });
		assert.equal((await listMailbox(db, 'owner', { view: 'spam' })).total, 0);
		assert.equal((await getMailboxCounts(db, 'owner')).inbox, 1);
	});

	test('flag updates cannot affect another account', async () => {
		assert.deepEqual(await expandToThreads(db, 'owner', ['foreign']), []);
		assert.equal(await setEmailFlags(db, 'owner', ['foreign'], { isSpam: true }), 0);
		assert.equal((await listMailbox(db, 'other', { view: 'inbox' })).total, 1);
	});

	test('folder actions require mail read scope for API tokens', () => {
		for (const action of ['archive', 'unarchive', 'spam', 'not-spam', 'inbox'] as const) {
			assert.equal(authorizeMailAction({ action, authMethod: 'api_token', scopes: ['mail:send'] }).ok, false);
			assert.equal(authorizeMailAction({ action, authMethod: 'api_token', scopes: ['mail:read'] }).ok, true);
		}
	});

	test('search operators combine, support quoted phrases, and respect ownership', async () => {
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'from:alex subject:Project "Design notes" is:unread' })).total, 1);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'subject:Project -from:alex' })).total, 1);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'subject:Private in:anywhere' })).total, 0);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: "subject:\"' OR 1=1 --\"" })).total, 0);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'after:2000-01-01 before:2001-01-01' })).total, 0);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'has:attachment' })).total, 0);
		sqlite.exec("INSERT INTO email_attachments(id,email_id,filename,content_type,size_bytes,content_base64) VALUES('file','received','Project notes.pdf','application/pdf',0,'')");
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'has:attachment filename:pdf' })).total, 1);
	});

	test('explicit folder searches include spam and trash without leaking them into All mail', async () => {
		const ids = await expandToThreads(db, 'owner', ['received']);
		await setEmailFlags(db, 'owner', ids, { isSpam: true });
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'Project' })).total, 0);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'in:spam Project' })).total, 1);
		await setEmailFlags(db, 'owner', ids, { trashed: true });
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'in:trash Project' })).total, 1);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', q: 'in:anywhere Project' })).total, 1);
	});

	test('labels apply to whole conversations, remain on new replies and can be removed', async () => {
		sqlite.exec("INSERT INTO mail_labels(id,user_id,name) VALUES('projects','owner','Projects'),('foreign-label','other','Private')");
		assert.equal(await applyMailLabels(db, 'owner', ['reply'], [{ labelId: 'projects', apply: true }]), true);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', labelId: 'projects' })).total, 1);
		sqlite.exec("INSERT INTO emails(id,user_id,direction,from_addr,to_addr,subject,thread_id) VALUES('new-reply','owner','inbound','alex@example.com','owner@example.com','Re: Project','thread')");
		const mailbox = await listMailbox(db, 'owner', { view: 'all', q: 'label:projects' });
		assert.equal(mailbox.total, 1);
		assert.deepEqual(mailbox.threads[0].labels, [{ id: 'projects', name: 'Projects' }]);
		assert.equal(await applyMailLabels(db, 'owner', ['new-reply'], [{ labelId: 'projects', apply: false }]), true);
		assert.equal((await listMailbox(db, 'owner', { view: 'all', labelId: 'projects' })).total, 0);
	});

	test('labels cannot be assigned across accounts; deleting a label preserves mail', async () => {
		sqlite.exec("INSERT INTO mail_labels(id,user_id,name) VALUES('projects','owner','Projects'),('foreign-label','other','Private')");
		assert.deepEqual(await listMailLabels(db, 'owner'), [{ id: 'projects', name: 'Projects' }]);
		assert.equal(await applyMailLabels(db, 'owner', ['received'], [{ labelId: 'foreign-label', apply: true }]), false);
		assert.equal(await applyMailLabels(db, 'owner', ['foreign'], [{ labelId: 'projects', apply: true }]), false);
		assert.equal(await applyMailLabels(db, 'owner', ['received'], [{ labelId: 'projects', apply: true }]), true);
		sqlite.exec("DELETE FROM mail_labels WHERE id = 'projects' AND user_id = 'owner'");
		assert.equal((await listMailbox(db, 'owner', { view: 'all' })).total, 1);
		assert.deepEqual(sqlite.query('SELECT * FROM email_labels').all(), []);
	});
});

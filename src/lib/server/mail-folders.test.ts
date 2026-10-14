/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { expandToThreads, getEmailForUser, getMailboxCounts, insertEmail, listEmails, listMailbox, listThreadMessages, setEmailFlags } from './mail-store';
import { threadHeadline } from '../mailbox-people';
import { handleCloudflareInbound } from './cloudflare-inbound';
import { handleResendWebhook } from './inbound';
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
	test('older mail reuses the most recent sender name from the same account in list and reader', async () => {
		await insertEmail(db, { userId: 'owner', direction: 'inbound', from: 'alex@example.com', fromName: 'Alex Chen', to: 'owner@example.com', subject: 'Another conversation', bodyText: 'Hello' });
		await insertEmail(db, { userId: 'other', direction: 'inbound', from: 'alex@example.com', fromName: 'A different name', to: 'other@example.com', subject: 'Private', bodyText: 'Private' });
		const thread = (await listMailbox(db, 'owner', { view: 'inbox' })).threads.find((t) => t.thread_id === 'thread')!;
		assert.equal(threadHeadline(thread, 'inbox'), 'Alex Chen');
		const email = (await getEmailForUser(db, 'owner', 'received'))!;
		const messages = await listThreadMessages(db, 'owner', email);
		assert.equal(messages.find((m) => m.id === 'received')?.from_name, 'Alex Chen');
		assert.equal((await listMailbox(db, 'other', { view: 'inbox' })).threads.find((t) => t.thread_id === 'foreign')?.participants[0].name, 'A different name');
	});
	test('missing sender names never reuse another account name', async () => {
		await insertEmail(db, { userId: 'other', direction: 'inbound', from: 'alex@example.com', fromName: 'Private name', to: 'other@example.com', subject: 'Private', bodyText: 'Private' });
		const thread = (await listMailbox(db, 'owner', { view: 'inbox' })).threads[0];
		assert.equal(thread.participants[0].name, null);
		const email = (await getEmailForUser(db, 'owner', 'received'))!;
		assert.equal((await listThreadMessages(db, 'owner', email)).find((m) => m.id === 'received')?.from_name, null);
	});
	test('Cloudflare inbound preserves the MIME sender name separately from the envelope address', async () => {
		sqlite.exec("UPDATE users SET is_admin=1 WHERE id='owner'; INSERT INTO domains(id,name) VALUES('test-domain','example.com'); INSERT INTO addresses(id,user_id,domain_id,address) VALUES('test-address','owner','test-domain','owner@example.com')");
		const raw = new Response('From: =?UTF-8?Q?Jos=C3=A9?= <jose@example.com>\r\nTo: owner@example.com\r\nSubject: MIME name\r\nMessage-ID: <mime-name@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from José.').body!;
		await handleCloudflareInbound({
			from: 'bounce@mailer.example.com', to: 'owner@example.com', raw,
			headers: new Headers(), setReject() { throw new Error('Unexpected rejection'); }
		}, { DB: db, ATTACHMENTS: {} } as Parameters<typeof handleCloudflareInbound>[1]);
		const message = (await listMailbox(db, 'owner', { view: 'inbox' })).threads.find((entry) => entry.subject === 'MIME name')!;
		assert.equal(threadHeadline(message, 'inbox'), 'José');
		assert.equal(message.participants[0].address, 'jose@example.com');
	});
	test('Resend inbound uses the header name when its API returns only a bare from address', async () => {
		sqlite.exec("UPDATE users SET is_admin=1 WHERE id='owner'; INSERT INTO domains(id,name) VALUES('test-domain','example.com'); INSERT INTO addresses(id,user_id,domain_id,address) VALUES('test-address','owner','test-domain','owner@example.com')");
		await handleResendWebhook({ type: 'email.received', data: { email_id: 'resend-test' } },
			{ DB: db, ATTACHMENTS: {} } as Parameters<typeof handleResendWebhook>[1],
			{
				async getReceivedEmail() { return { from: 'hello@m.paystack.com', headers: { From: 'Paystack <hello@m.paystack.com>' }, to: ['owner@example.com'], subject: 'Resend name', text: 'Hello', html: null }; },
				async listReceivedAttachments() { return []; }
			} as unknown as Parameters<typeof handleResendWebhook>[2]);
		const message = (await listMailbox(db, 'owner', { view: 'inbox' })).threads.find((entry) => entry.subject === 'Resend name')!;
		assert.equal(threadHeadline(message, 'inbox'), 'Paystack');
		assert.equal(message.participants[0].address, 'hello@m.paystack.com');
	});
	test('stores supplied sender names and builds clean mailbox/API previews from original HTML', async () => {
		const id = await insertEmail(db, {
			userId: 'owner', direction: 'inbound', from: 'hello@m.paystack.com', fromName: 'Paystack',
			to: 'owner@example.com', subject: 'Transaction history',
			bodyText: 'Your history is intact. a{ text-decoration:none !important; } Image Hello Muiz',
			bodyHtml: '<style>a{ text-decoration:none !important; }</style><p>Your history is intact.</p><img alt="Image"><p>Hello Muiz</p>'
		});
		const mailbox = await listMailbox(db, 'owner', { view: 'inbox' });
		const message = mailbox.threads.find((entry) => entry.latest_id === id)!;
		assert.equal(threadHeadline(message, 'inbox'), 'Paystack');
		assert.equal(message.participants[0].address, 'hello@m.paystack.com');
		assert.equal(message.preview, 'Your history is intact. Hello Muiz');
		assert.equal((await listEmails(db, 'owner')).find((entry) => entry.id === id)?.preview, message.preview);
		assert.equal((await listMailbox(db, 'other', { view: 'inbox' })).threads.some((entry) => entry.latest_id === id), false);
	});
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

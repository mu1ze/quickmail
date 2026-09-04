import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import {
	loadMailAutomations,
	runUserCleanup,
	saveMailAutomations,
	type MailAutomationsSettings
} from './mail-automations';

type EmailRow = {
	id: string;
	user_id: string;
	direction: string;
	from_addr: string;
	subject: string;
	body_text: string | null;
	is_read: number;
	is_starred: number;
	is_pinned: number;
	deleted_at: string | null;
	auto_trashed_at: string | null;
	auto_trash_reason: string | null;
	snoozed_until: string | null;
	status: string | null;
	created_at: string;
};

type AutomationRow = {
	user_id: string;
	weekly_cleanup: number;
	ai_classify: number;
	ai_summaries: number;
	rules: string;
	last_cleanup_at: string | null;
	last_cleanup_trashed: number;
};

function createMailboxDb(emails: EmailRow[], automations: AutomationRow | null = null) {
	const mail = emails.map((row) => ({ ...row }));
	let settings = automations ? { ...automations } : null;

	function prepare(sql: string) {
		const bound: unknown[] = [];
		const statement = {
			bind(...values: unknown[]) {
				bound.push(...values);
				return statement;
			},
			async first() {
				if (sql.includes('FROM mail_automations')) {
					if (!settings || settings.user_id !== String(bound[0])) return null;
					return { ...settings };
				}
				return null;
			},
			async all() {
				if (sql.includes('FROM emails') && sql.includes("direction = 'inbound'")) {
					const userId = String(bound[0]);
					const limit = Number(bound[1] ?? 100);
					const results = mail
						.filter(
							(row) =>
								row.user_id === userId &&
								row.direction === 'inbound' &&
								row.is_read === 1 &&
								row.is_starred === 0 &&
								row.is_pinned === 0 &&
								row.deleted_at === null &&
								row.status !== 'draft'
						)
						.slice(0, limit)
						.map((row) => ({
							id: row.id,
							thread_id: row.id,
							from_addr: row.from_addr,
							subject: row.subject,
							body_head: row.body_text
						}));
					return { results };
				}
				return { results: [] };
			},
			async run() {
				if (sql.includes('INSERT INTO mail_automations')) {
					const userId = String(bound[0]);
					if (sql.includes('weekly_cleanup') && bound.length >= 5 && typeof bound[4] === 'string') {
						settings = {
							user_id: userId,
							weekly_cleanup: Number(bound[1]),
							ai_classify: Number(bound[2]),
							ai_summaries: Number(bound[3]),
							rules: String(bound[4]),
							last_cleanup_at: settings?.last_cleanup_at ?? null,
							last_cleanup_trashed: settings?.last_cleanup_trashed ?? 0
						};
					} else {
						settings = {
							user_id: userId,
							weekly_cleanup: settings?.weekly_cleanup ?? 1,
							ai_classify: settings?.ai_classify ?? 0,
							ai_summaries: settings?.ai_summaries ?? 0,
							rules: settings?.rules ?? '[]',
							last_cleanup_at: 'now',
							last_cleanup_trashed: Number(bound[1] ?? 0)
						};
					}
					return { meta: { changes: 1 } };
				}
				if (sql.includes('UPDATE emails') && sql.includes('auto_trashed_at')) {
					const id = String(bound[2]);
					const userId = String(bound[1]);
					const reason = String(bound[0]);
					const row = mail.find((entry) => entry.id === id && entry.user_id === userId);
					if (
						!row ||
						row.direction !== 'inbound' ||
						row.is_read !== 1 ||
						row.is_starred === 1 ||
						row.is_pinned === 1 ||
						row.deleted_at
					) {
						return { meta: { changes: 0 } };
					}
					row.deleted_at = 'now';
					row.auto_trashed_at = 'now';
					row.auto_trash_reason = reason;
					return { meta: { changes: 1 } };
				}
				return { meta: { changes: 0 } };
			}
		};
		return statement;
	}

	return {
		db: { prepare, async batch() {} } as unknown as D1Database,
		mail,
		getSettings: () => settings
	};
}

function seedEmail(overrides: Partial<EmailRow> & Pick<EmailRow, 'id' | 'from_addr' | 'subject'>): EmailRow {
	return {
		user_id: 'user-ada',
		direction: 'inbound',
		body_text: 'Hello',
		is_read: 1,
		is_starred: 0,
		is_pinned: 0,
		deleted_at: null,
		auto_trashed_at: null,
		auto_trash_reason: null,
		snoozed_until: null,
		status: null,
		created_at: '2026-01-01',
		...overrides
	};
}

describe('mail automation settings', () => {
	test('defaults are off so inbound mail is never cleaned until opted in', async () => {
		const { db } = createMailboxDb([]);
		assert.deepEqual(await loadMailAutomations(db, 'user-ada'), {
			weeklyCleanup: false,
			aiClassify: false,
			aiSummaries: false,
			rules: [],
			lastCleanupAt: null,
			lastCleanupTrashed: 0
		});
	});

	test('saves weekly cleanup and sender rules', async () => {
		const { db } = createMailboxDb([]);
		const saved = await saveMailAutomations(db, 'user-ada', {
			weeklyCleanup: true,
			rules: [{ field: 'domain', value: 'promo.example', action: 'trash' }]
		});
		assert.equal(saved.weeklyCleanup, true);
		assert.equal(saved.rules[0].value, 'promo.example');
	});
});

describe('weekly cleanup of opened mail', () => {
	const settings: MailAutomationsSettings = {
		weeklyCleanup: true,
		aiClassify: false,
		aiSummaries: false,
		rules: [],
		lastCleanupAt: null,
		lastCleanupTrashed: 0
	};

	test('moves opened promotions to trash and leaves unread, starred, and personal mail', async () => {
		const { db, mail } = createMailboxDb([
			seedEmail({
				id: 'unread-promo',
				from_addr: 'newsletter@brand.example',
				subject: 'Weekly newsletter',
				body_text: 'Unsubscribe here',
				is_read: 0
			}),
			seedEmail({
				id: 'starred-promo',
				from_addr: 'newsletter@brand.example',
				subject: 'Weekly newsletter',
				body_text: 'Unsubscribe here',
				is_starred: 1
			}),
			seedEmail({
				id: 'opened-promo',
				from_addr: 'newsletter@brand.example',
				subject: 'Weekly newsletter',
				body_text: 'You are receiving this email because you subscribed. Unsubscribe.'
			}),
			seedEmail({
				id: 'opened-friend',
				from_addr: 'sam@friends.example',
				subject: 'Dinner Friday?',
				body_text: 'Pizza after work?'
			})
		]);

		const result = await runUserCleanup(db, 'user-ada', settings);
		assert.equal(result.trashed, 1);
		assert.equal(mail.find((row) => row.id === 'opened-promo')?.deleted_at, 'now');
		assert.equal(mail.find((row) => row.id === 'unread-promo')?.deleted_at, null);
		assert.equal(mail.find((row) => row.id === 'starred-promo')?.deleted_at, null);
		assert.equal(mail.find((row) => row.id === 'opened-friend')?.deleted_at, null);
	});

	test('does not trash starred promotions even after they are opened', async () => {
		const { db, mail } = createMailboxDb([
			seedEmail({
				id: 'starred',
				from_addr: 'newsletter@brand.example',
				subject: 'Weekly newsletter',
				body_text: 'Unsubscribe',
				is_starred: 1
			})
		]);
		const result = await runUserCleanup(db, 'user-ada', settings);
		assert.equal(result.trashed, 0);
		assert.equal(mail[0].deleted_at, null);
	});
});

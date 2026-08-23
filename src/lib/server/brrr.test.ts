import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import {
	BRRR_SEND_URL,
	buildBrrrNewMailPayload,
	loadBrrrDestination,
	maskBrrrSecret,
	parseBrrrWebhook,
	parseSenderSoundRules,
	readPublicAppOrigin,
	resolveBrrrSound,
	sendBrrrNotification
} from './brrr';
import { notifyNewMail } from './push-notifications';

describe('Brrr webhook parsing', () => {
	test('accepts a full webhook URL or the secret alone', () => {
		assert.equal(
			parseBrrrWebhook('https://api.brrr.now/v1/br_usr_a1b2c3d4e5f6g7h8i9j0'),
			'br_usr_a1b2c3d4e5f6g7h8i9j0'
		);
		assert.equal(parseBrrrWebhook('  br_usr_a1b2c3d4e5f6g7h8i9j0  '), 'br_usr_a1b2c3d4e5f6g7h8i9j0');
		assert.equal(parseBrrrWebhook('br_dev_abc123'), 'br_dev_abc123');
	});

	test('rejects other hosts, schemes, and junk', () => {
		assert.equal(parseBrrrWebhook('https://evil.example/v1/br_usr_a1b2c3d4e5f6g7h8i9j0'), null);
		assert.equal(parseBrrrWebhook('http://api.brrr.now/v1/br_usr_a1b2c3d4e5f6g7h8i9j0'), null);
		assert.equal(parseBrrrWebhook('https://api.brrr.now/v2/br_usr_a1b2c3d4e5f6g7h8i9j0'), null);
		assert.equal(parseBrrrWebhook('https://api.brrr.now/v1/not-a-secret'), null);
		assert.equal(parseBrrrWebhook('https://user:pass@api.brrr.now/v1/br_usr_a1b2c3d4e5f6g7h8i9j0'), null);
		assert.equal(parseBrrrWebhook('br_'), null);
		assert.equal(parseBrrrWebhook(''), null);
		assert.equal(parseBrrrWebhook(null), null);
	});
});

describe('Brrr secret masking', () => {
	test('keeps a short prefix and the last four characters', () => {
		assert.equal(maskBrrrSecret('br_usr_a1b2c3d4e5f6g7h8i9j0'), 'br_usr_…i9j0');
		assert.equal(maskBrrrSecret('br_dev_abcd'), 'br_dev_…abcd');
	});
});

describe('Brrr sound rules', () => {
	test('matches a sender address and otherwise uses the default', () => {
		const rules = parseSenderSoundRules([
			{ sender: 'Alerts <alerts@example.com>', sound: 'emergency' },
			{ sender: 'billing@example.com', sound: 'cha_ching' }
		]);
		assert.ok(rules);
		assert.equal(resolveBrrrSound('Ada <alerts@example.com>', 'brrr', rules), 'emergency');
		assert.equal(resolveBrrrSound('billing@example.com', 'brrr', rules), 'cha_ching');
		assert.equal(resolveBrrrSound('other@example.com', 'brrr', rules), 'brrr');
	});

	test('rejects unknown sounds and oversized rule lists', () => {
		assert.equal(parseSenderSoundRules([{ sender: 'a@example.com', sound: 'trombone' }]), null);
		assert.equal(
			parseSenderSoundRules(
				Array.from({ length: 21 }, (_, index) => ({
					sender: `user${index}@example.com`,
					sound: 'default'
				}))
			),
			null
		);
		assert.deepEqual(parseSenderSoundRules([]), []);
	});
});

describe('Brrr mail payload', () => {
	test('omits open_url without an origin and includes it when PUBLIC_APP_URL is set', () => {
		assert.equal(readPublicAppOrigin(undefined), null);
		assert.equal(readPublicAppOrigin('https://mail.example.com/inbox'), 'https://mail.example.com');

		assert.deepEqual(
			buildBrrrNewMailPayload({
				subject: 'Project update',
				from: 'Ada <ada@example.com>',
				emailId: 'mail/id',
				origin: null,
				sound: 'brrr'
			}),
			{
				title: 'Project update',
				message: 'From Ada <ada@example.com>',
				thread_id: 'quickmail-inbox',
				sound: 'brrr'
			}
		);

		assert.equal(
			buildBrrrNewMailPayload({
				subject: 'Hello',
				from: 'ada@example.com',
				emailId: 'mail/id',
				origin: 'https://mail.example.com',
				sound: 'default'
			}).open_url,
			'https://mail.example.com/mail/mail%2Fid'
		);
	});
});

type StoredBrrrRow = {
	user_id: string;
	webhook_key: string;
	default_sound: string;
	sender_sounds: string;
};

function createMemoryBrrrDb(row: StoredBrrrRow | null) {
	function prepare(sql: string) {
		let bound: unknown[] = [];
		const statement = {
			bind(...args: unknown[]) {
				bound = args;
				return statement;
			},
			async first() {
				if (!sql.includes('FROM brrr_destinations')) {
					throw new Error(`Unexpected SQL: ${sql}`);
				}
				if (!row || row.user_id !== String(bound[0])) return null;
				return {
					webhook_key: row.webhook_key,
					default_sound: row.default_sound,
					sender_sounds: row.sender_sounds
				};
			},
			async all() {
				return { results: [] };
			},
			async run() {
				return { meta: { changes: 1 } };
			}
		};
		return statement;
	}

	return {
		prepare,
		async batch() {
			/* unused in Brrr delivery */
		}
	} as unknown as D1Database;
}

describe('Brrr delivery on new mail', () => {
	test('posts JSON even when VAPID is missing', async () => {
		const calls: Array<{ url: string; authorization: string | null; body: unknown }> = [];
		const db = createMemoryBrrrDb({
			user_id: 'user-1',
			webhook_key: 'br_usr_a1b2c3d4e5f6g7h8i9j0',
			default_sound: 'brrr',
			sender_sounds: JSON.stringify([{ sender: 'alerts@example.com', sound: 'emergency' }])
		});

		await notifyNewMail(
			{
				DB: db,
				PUBLIC_APP_URL: 'https://mail.example.com',
				fetch: (async (input, init) => {
					const request = new Request(input, init);
					calls.push({
						url: request.url,
						authorization: request.headers.get('Authorization'),
						body: await request.json()
					});
					return new Response('ok', { status: 200 });
				}) as typeof fetch
			},
			{
				emailId: 'mail-1',
				userId: 'user-1',
				from: 'Alerts <alerts@example.com>',
				subject: 'Server down'
			}
		);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, BRRR_SEND_URL);
		assert.equal(calls[0].authorization, 'Bearer br_usr_a1b2c3d4e5f6g7h8i9j0');
		assert.deepEqual(calls[0].body, {
			title: 'Server down',
			message: 'From Alerts <alerts@example.com>',
			thread_id: 'quickmail-inbox',
			open_url: 'https://mail.example.com/mail/mail-1',
			sound: 'emergency'
		});
	});

	test('does not fetch when the recipient has no Brrr key', async () => {
		let fetched = false;
		await notifyNewMail(
			{
				DB: createMemoryBrrrDb(null),
				fetch: (async () => {
					fetched = true;
					return new Response('ok', { status: 200 });
				}) as typeof fetch
			},
			{
				emailId: 'mail-1',
				userId: 'user-1',
				from: 'ada@example.com',
				subject: 'Hello'
			}
		);
		assert.equal(fetched, false);
	});
});

test('sendBrrrNotification keeps the key in the Authorization header', async () => {
	const result = await sendBrrrNotification(
		'br_usr_secret',
		{ title: 'Hi', message: 'There', sound: 'default' },
		(async (input, init) => {
			const request = new Request(input, init);
			assert.equal(request.url, BRRR_SEND_URL);
			assert.equal(request.headers.get('Authorization'), 'Bearer br_usr_secret');
			assert.equal(request.method, 'POST');
			return new Response('ok', { status: 201 });
		}) as typeof fetch
	);
	assert.deepEqual(result, { ok: true, status: 201 });
});

test('loadBrrrDestination returns the stored key only for delivery', async () => {
	const destination = await loadBrrrDestination(
		createMemoryBrrrDb({
			user_id: 'user-1',
			webhook_key: 'br_usr_secret',
			default_sound: 'cat_meow',
			sender_sounds: '[]'
		}),
		'user-1'
	);
	assert.equal(destination?.webhookKey, 'br_usr_secret');
	assert.equal(destination?.defaultSound, 'cat_meow');
});

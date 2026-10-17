import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	DEFAULT_NOTIFICATION_PREFS,
	cleanVipList,
	decideNotification,
	inQuietHours,
	isAutomatedMail,
	isVipSender,
	sanitizeNotificationPrefs,
	type NotificationPrefs
} from './notification-rules';

const prefs = (over: Partial<NotificationPrefs>): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...over });
const person = { address: 'dana@northwind.example', signals: {} };
const newsletter = { address: 'hello@margin.example', signals: { hasListUnsubscribe: true } };

describe('notification rules', () => {
	test('VIP entries match exact addresses, whole domains and subdomains', () => {
		const vips = cleanVipList('Dana@Northwind.example, client.example ; bogus @@ x');
		assert.deepEqual(vips, ['dana@northwind.example', '@client.example']);
		assert.equal(isVipSender(vips, 'DANA@northwind.example'), true);
		assert.equal(isVipSender(vips, 'ceo@client.example'), true);
		assert.equal(isVipSender(vips, 'ops@eu.client.example'), true);
		assert.equal(isVipSender(vips, 'someone@notclient.example'), false);
	});

	test('bulk headers and robot senders count as automated, people do not', () => {
		assert.equal(isAutomatedMail({ hasListUnsubscribe: true }, 'a@b.example'), true);
		assert.equal(isAutomatedMail({ listId: '<team.lists.example>' }, 'a@b.example'), true);
		assert.equal(isAutomatedMail({ autoSubmitted: 'auto-generated' }, 'a@b.example'), true);
		assert.equal(isAutomatedMail({ autoSubmitted: 'no' }, 'a@b.example'), false);
		assert.equal(isAutomatedMail({ precedence: 'bulk' }, 'a@b.example'), true);
		assert.equal(isAutomatedMail({}, 'no-reply@service.example'), true);
		assert.equal(isAutomatedMail({}, 'notifications+abc@github.example'), true);
		assert.equal(isAutomatedMail({}, 'nora@service.example'), false);
	});

	test('quiet hours wrap past midnight in the chosen zone', () => {
		const quiet = { enabled: true, start: 22 * 60, end: 7 * 60, tz: 'America/Toronto' };
		assert.equal(inQuietHours(quiet, new Date('2026-10-15T03:00:00Z')), true); // 23:00 Toronto
		assert.equal(inQuietHours(quiet, new Date('2026-10-15T10:30:00Z')), true); // 06:30
		assert.equal(inQuietHours(quiet, new Date('2026-10-15T15:00:00Z')), false); // 11:00
		assert.equal(inQuietHours({ ...quiet, enabled: false }, new Date('2026-10-15T03:00:00Z')), false);
	});

	test('modes, quiet hours and VIPs combine as expected', () => {
		const night = new Date('2026-10-15T03:00:00Z');
		const day = new Date('2026-10-15T15:00:00Z');
		const quiet = { enabled: true, start: 22 * 60, end: 7 * 60, tz: 'America/Toronto' };
		assert.equal(decideNotification(prefs({}), newsletter, day).notify, true);
		assert.equal(decideNotification(prefs({ mode: 'people' }), newsletter, day).notify, false);
		assert.equal(decideNotification(prefs({ mode: 'people' }), person, day).notify, true);
		assert.equal(decideNotification(prefs({ mode: 'vip' }), person, day).notify, false);
		assert.equal(decideNotification(prefs({ mode: 'vip', vips: ['@northwind.example'] }), person, day).notify, true);
		assert.equal(decideNotification(prefs({ quiet }), person, night).notify, false);
		assert.deepEqual(decideNotification(prefs({ quiet, vips: ['dana@northwind.example'] }), person, night), { notify: true, vip: true });
		// Sign-in codes get through filters and quiet hours unless turned off.
		const code = { address: 'no-reply@github.example', signals: {}, hasCode: true };
		assert.equal(decideNotification(prefs({ mode: 'people', quiet }), code, night).notify, true);
		assert.equal(decideNotification(prefs({ mode: 'people', codes: false }), code, day).notify, false);
	});

	test('stored preferences are sanitized', () => {
		const clean = sanitizeNotificationPrefs({ mode: 'loud', vips: ['x'], preview: 'yes', quiet: { enabled: true, start: 1450, tz: 'Nope/Zone' } });
		assert.equal(clean.mode, 'all');
		assert.deepEqual(clean.vips, []);
		assert.equal(clean.preview, false);
		assert.equal(clean.codes, true);
		assert.equal(sanitizeNotificationPrefs({ codes: false }).codes, false);
		assert.equal(clean.quiet.start, 22 * 60);
		assert.equal(clean.quiet.tz, 'UTC');
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	classifyOpenedMail,
	heuristicClassify,
	isTransactionalKeep,
	matchAutomationRules,
	parseAiClassifyResponse,
	parseAutomationRules,
	ruleMatches,
	type AutomationRule
} from './mail-classify';

const promoRule: AutomationRule = {
	id: 'r1',
	field: 'domain',
	value: 'deals.example',
	action: 'trash'
};

const keepRule: AutomationRule = {
	id: 'r2',
	field: 'from',
	value: 'ada@deals.example',
	action: 'keep'
};

describe('automation rules', () => {
	test('parses keep/trash rules and drops empty values', () => {
		const rules = parseAutomationRules([
			{ field: 'from', value: '  news@shop.example  ', action: 'trash' },
			{ field: 'subject', value: '   ', action: 'keep' },
			{ id: 'keep-1', field: 'domain', value: 'family.example', action: 'keep' }
		]);
		assert.ok(rules);
		assert.equal(rules.length, 2);
		assert.equal(rules[0].field, 'from');
		assert.equal(rules[0].value, 'news@shop.example');
		assert.equal(rules[1].id, 'keep-1');
	});

	test('rejects unknown fields, actions, and oversized lists', () => {
		assert.equal(parseAutomationRules({ field: 'from', value: 'a', action: 'trash' }), null);
		assert.equal(parseAutomationRules([{ field: 'body', value: 'x', action: 'trash' }]), null);
		assert.equal(parseAutomationRules([{ field: 'from', value: 'x', action: 'delete' }]), null);
		assert.equal(
			parseAutomationRules(
				Array.from({ length: 31 }, (_, index) => ({
					field: 'from',
					value: `user${index}@example.com`,
					action: 'trash'
				}))
			),
			null
		);
	});

	test('matches from, domain, and subject needles', () => {
		assert.equal(
			ruleMatches(promoRule, { from: 'Shop <hello@deals.example>', subject: 'Hi', body: '' }),
			true
		);
		assert.equal(
			ruleMatches(promoRule, { from: 'hello@mail.deals.example', subject: 'Hi', body: '' }),
			true
		);
		assert.equal(
			ruleMatches(
				{ id: 's', field: 'subject', value: '% off', action: 'trash' },
				{ from: 'a@b.c', subject: '40% off sneakers', body: '' }
			),
			true
		);
		assert.equal(ruleMatches(promoRule, { from: 'ada@elsewhere.example', subject: 'Hi', body: '' }), false);
	});

	test('keep rules beat trash rules for the same sender', () => {
		const decision = matchAutomationRules(
			{ from: 'Ada <ada@deals.example>', subject: '40% off', body: 'Unsubscribe' },
			[promoRule, keepRule]
		);
		assert.equal(decision?.action, 'keep');
		assert.equal(decision?.source, 'keep_rule');
	});
});

describe('promo heuristics', () => {
	test('keeps receipts, codes, and shipping even with unsubscribe text', () => {
		assert.equal(
			isTransactionalKeep({
				from: 'Amazon <order@amazon.com>',
				subject: 'Your order has shipped',
				body: 'Tracking number 1Z. Unsubscribe from marketing.'
			}),
			true
		);
		assert.equal(
			heuristicClassify({
				from: 'security@bank.example',
				subject: 'Your one-time code is 482911',
				body: 'Do not share this security code.'
			}).action,
			'keep'
		);
		assert.equal(
			heuristicClassify({
				from: 'noreply@shop.example',
				subject: 'Password reset',
				body: 'Reset your password using this link. Unsubscribe.'
			}).source,
			'transactional'
		);
	});

	test('trashes newsletters and percent-off mail after they have been opened', () => {
		assert.equal(
			heuristicClassify({
				from: 'newsletter@brand.example',
				subject: 'This week’s digest',
				body: 'You are receiving this email because you subscribed. Unsubscribe.'
			}).action,
			'trash'
		);
		assert.equal(
			heuristicClassify({
				from: 'hello@brand.example',
				subject: '40% off everything this weekend',
				body: 'Shop the sale.'
			}).action,
			'trash'
		);
	});

	test('keeps ordinary personal mail', () => {
		assert.equal(
			heuristicClassify({
				from: 'Sam <sam@friends.example>',
				subject: 'Dinner Friday?',
				body: 'Want to grab pizza after work?'
			}).action,
			'keep'
		);
	});
});

describe('AI classify parser', () => {
	test('only trashes on an explicit JSON trash action', () => {
		assert.equal(parseAiClassifyResponse('{"action":"trash","reason":"newsletter"}')?.action, 'trash');
		assert.equal(
			parseAiClassifyResponse('Sure.\n```json\n{"action":"trash"}\n```')?.source,
			'ai'
		);
		assert.equal(parseAiClassifyResponse({ response: '{"action":"keep"}' })?.action, 'keep');
		assert.equal(parseAiClassifyResponse('{"action":"maybe"}'), null);
		assert.equal(parseAiClassifyResponse('delete it'), null);
		assert.equal(parseAiClassifyResponse(''), null);
	});
});

describe('opened-mail classifier', () => {
	test('never asks AI once a keep-rule or receipt matches', async () => {
		let called = false;
		const keep = await classifyOpenedMail(
			{ from: 'ada@deals.example', subject: '40% off', body: 'Sale' },
			{
				rules: [keepRule],
				classifyWithAi: async () => {
					called = true;
					return { action: 'trash', reason: 'nope', source: 'ai' };
				}
			}
		);
		assert.equal(keep.action, 'keep');
		assert.equal(called, false);

		const receipt = await classifyOpenedMail(
			{ from: 'orders@shop.example', subject: 'Invoice #441', body: 'Amount due $12' },
			{
				rules: [],
				classifyWithAi: async () => {
					called = true;
					return { action: 'trash', reason: 'nope', source: 'ai' };
				}
			}
		);
		assert.equal(receipt.source, 'transactional');
		assert.equal(called, false);
	});

	test('heuristics trash promotions without AI, AI may catch leftover bulk', async () => {
		const promo = await classifyOpenedMail(
			{
				from: 'newsletter@brand.example',
				subject: 'Weekly newsletter',
				body: 'Unsubscribe here'
			},
			{
				rules: [],
				classifyWithAi: async () => ({ action: 'keep', reason: 'x', source: 'ai' })
			}
		);
		assert.equal(promo.source, 'heuristic');

		const leftover = await classifyOpenedMail(
			{ from: 'hello@brand.example', subject: 'Updates from us', body: 'Hi there' },
			{
				rules: [],
				classifyWithAi: async () => ({ action: 'trash', reason: 'bulk updates', source: 'ai' })
			}
		);
		assert.equal(leftover.action, 'trash');
		assert.equal(leftover.source, 'ai');
	});
});

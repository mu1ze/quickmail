import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	LONG_SUMMARY_INPUT_CHARS,
	LONG_THREAD_CHARS,
	SUMMARY_MAX_CHARS,
	parseAiSummaryResponse,
	summarizeThread,
	type SummaryModels
} from './mail-summaries';

describe('thread summary parser', () => {
	test('keeps a short plain sentence and rejects empty model output', () => {
		assert.equal(
			parseAiSummaryResponse({ response: '  Ada asked about dinner on Friday.  ' }),
			'Ada asked about dinner on Friday.'
		);
		assert.equal(parseAiSummaryResponse('Sure.\n```\nTeam agreed to ship Friday.\n```'), 'Team agreed to ship Friday.');
		assert.equal(parseAiSummaryResponse('no'), null);
		assert.equal(parseAiSummaryResponse(''), null);
	});
});

describe('thread summary length', () => {
	test('an over-long reply ends on its last full sentence', () => {
		const reply =
			'Dana moved the billing cutover from November 3 to November 10 after QA found a double-proration bug in staging. ' +
			'She needs decisions by Wednesday noon on notifying about 1,200 legacy annual customers and on the rollback budget.';
		const summary = parseAiSummaryResponse(reply)!;
		assert.ok(reply.length > SUMMARY_MAX_CHARS);
		assert.equal(
			summary,
			'Dana moved the billing cutover from November 3 to November 10 after QA found a double-proration bug in staging.'
		);
	});

	test('without a usable sentence break it cuts at a word and marks the cut', () => {
		const summary = parseAiSummaryResponse(`Launch update ${'with more detail '.repeat(20)}`)!;
		assert.ok(summary.length <= SUMMARY_MAX_CHARS);
		assert.ok(summary.endsWith('detail…') || summary.endsWith('more…') || summary.endsWith('with…'));
	});

	test('short replies are left alone', () => {
		assert.equal(parseAiSummaryResponse('Team agreed to ship Friday. Ada owns the release notes.'), 'Team agreed to ship Friday. Ada owns the release notes.');
	});
});

describe('thread summary routing', () => {
	const longBody = 'The launch moved to Friday because QA found a billing bug. '.repeat(400);
	const shortBody = 'Dinner on Friday at seven?';

	function fakes(longReply: () => Promise<string | null>) {
		const calls = { ai: [] as string[], long: [] as string[] };
		const models: SummaryModels = {
			ai: {
				run: async (_model, input) => {
					const messages = input.messages as { content: string }[];
					calls.ai.push(messages[1].content);
					return { response: 'Workers AI summary of the thread.' };
				}
			},
			summarizeLong: async (_system, user) => {
				calls.long.push(user);
				return longReply();
			}
		};
		return { models, calls };
	}

	test('long threads go to Haiku with more of the body', async () => {
		const { models, calls } = fakes(async () => 'Launch slipped to Friday over a billing bug.');
		const summary = await summarizeThread(models, { from: 'ada@example.com', subject: 'Launch', body: longBody });
		assert.equal(summary, 'Launch slipped to Friday over a billing bug.');
		assert.equal(calls.ai.length, 0);
		assert.equal(calls.long.length, 1);
		assert.ok(calls.long[0].length > LONG_THREAD_CHARS);
		assert.ok(calls.long[0].length <= LONG_SUMMARY_INPUT_CHARS + 200);
	});

	test('the prompt states the character limit', async () => {
		let system = '';
		const models: SummaryModels = { summarizeLong: async (prompt) => { system = prompt; return 'Launch slipped to Friday.'; } };
		await summarizeThread(models, { from: 'ada@example.com', subject: 'Launch', body: longBody });
		assert.match(system, /under \d+ characters/);
	});

	test('short mail stays on Workers AI', async () => {
		const { models, calls } = fakes(async () => 'should not be used');
		const summary = await summarizeThread(models, { from: 'sam@example.com', subject: 'Dinner', body: shortBody });
		assert.equal(summary, 'Workers AI summary of the thread.');
		assert.equal(calls.long.length, 0);
	});

	test('falls back to Workers AI when Haiku fails, declines, or is not configured', async () => {
		const failing = fakes(async () => { throw new Error('openrouter down'); });
		const warn = console.warn;
		console.warn = () => {};
		try {
			assert.equal(await summarizeThread(failing.models, { from: 'a@example.com', subject: 'Launch', body: longBody }), 'Workers AI summary of the thread.');
		} finally {
			console.warn = warn;
		}

		const declined = fakes(async () => null);
		assert.equal(await summarizeThread(declined.models, { from: 'a@example.com', subject: 'Launch', body: longBody }), 'Workers AI summary of the thread.');

		const { models, calls } = fakes(async () => 'unused');
		models.summarizeLong = null;
		assert.equal(await summarizeThread(models, { from: 'a@example.com', subject: 'Launch', body: longBody }), 'Workers AI summary of the thread.');
		assert.ok(calls.ai[0].length <= LONG_THREAD_CHARS + 200);
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAiSummaryResponse } from './mail-summaries';

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

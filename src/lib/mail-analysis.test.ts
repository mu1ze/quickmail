import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisSignals } from './mail-analysis';
import { answers } from './server/testing/analysis-fixtures';

test('confidence gates category, independently of reply and deadline hints', () => {
	assert.equal(analysisSignals(answers(0.9)).category, 'work');
	const uncertain = analysisSignals(answers(0.899));
	assert.equal(uncertain.category, null);
	assert.equal(uncertain.review, true);
	assert.equal(uncertain.needsReply, true);
});
test('suspected phishing retains purpose but suppresses actionable hints', () => {
	const a = answers(); a.phishing.noul = 0.51;
	assert.deepEqual(analysisSignals(a), { category: 'work', confidence: 0.95, review: true, phishing: true, spam: false, needsReply: false, deadline: false, urgency: 1 });
});
test('threshold boundary is explicit and uncertainty is not a fabricated category', () => {
	const a = answers(0.5); a.needs_reply.noul = a.deadline.noul = a.spam.noul = a.phishing.noul = 0.5;
	const result = analysisSignals(a);
	assert.equal(result.category, null); assert.equal(result.phishing, false); assert.equal(result.needsReply, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisSignals, CATEGORY_DEFINITIONS, type AnalysisAnswers } from './mail-analysis';

export function answers(confidence = 0.95): AnalysisAnswers {
	return {
		folder: { type: 'choice', choice: 'work', confidence, probabilities: Object.fromEntries(Object.keys(CATEGORY_DEFINITIONS).map(k => [k, k === 'work' ? 1 : 0])) as AnalysisAnswers['folder']['probabilities'] },
		urgency: { type: 'score', score: 1, confidence: 1, probabilities: { '0': 0, '1': 1, '2': 0 }, legend: { '0': 'None', '1': 'Few days', '2': 'Today' } },
		needs_reply: { type: 'noul', noul: 0.8 }, phishing: { type: 'noul', noul: 0.1 },
		deadline: { type: 'noul', noul: 0.8 }, spam: { type: 'noul', noul: 0.1 }
	};
}
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

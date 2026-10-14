import { CATEGORY_DEFINITIONS, type AnalysisAnswers } from '../../mail-analysis';
export function answers(confidence = 0.95): AnalysisAnswers {
	return {
		folder: { type: 'choice', choice: 'work', confidence, probabilities: Object.fromEntries(Object.keys(CATEGORY_DEFINITIONS).map(k => [k, k === 'work' ? 1 : 0])) as AnalysisAnswers['folder']['probabilities'] },
		urgency: { type: 'score', score: 1, confidence: 1, probabilities: { '0': 0, '1': 1, '2': 0 }, legend: { '0': 'None', '1': 'Few days', '2': 'Today' } },
		needs_reply: { type: 'noul', noul: 0.8 }, phishing: { type: 'noul', noul: 0.1 },
		deadline: { type: 'noul', noul: 0.8 }, spam: { type: 'noul', noul: 0.1 }
	};
}

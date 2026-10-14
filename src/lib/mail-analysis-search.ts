import { ANALYSIS_VERSION, CATEGORY_GROUPS, isMailCategory } from './mail-analysis';

/** All predicates operate on the same conversation as alias e, with owner guards. */
const thread = 'COALESCE(m.thread_id,m.id)=COALESCE(e.thread_id,e.id)';
const active = "m.user_id=e.user_id AND m.direction='inbound' AND m.deleted_at IS NULL";
const latest = `SELECT m.id FROM emails m WHERE ${active} AND ${thread} ORDER BY datetime(m.created_at) DESC,m.id DESC LIMIT 1`;
const joins = `LEFT JOIN email_analysis a ON a.email_id=m.id AND a.user_id=m.user_id AND a.version='${ANALYSIS_VERSION}'
	LEFT JOIN email_analysis_corrections c ON c.email_id=m.id AND c.user_id=m.user_id
	LEFT JOIN email_analysis_jobs j ON j.email_id=m.id AND j.user_id=m.user_id AND j.version='${ANALYSIS_VERSION}'`;
const warning = '(COALESCE(c.warning_dismissed,0)=0 AND (a.phishing=1 OR a.spam=1))';
const reply = `(a.needs_reply=1 AND COALESCE(c.task_done,0)=0 AND a.phishing=0 AND a.spam=0
	AND NOT EXISTS(SELECT 1 FROM emails sent WHERE sent.user_id=m.user_id AND sent.direction='outbound' AND sent.reply_to_email_id=m.id AND sent.status IN ('sent','delivered','delayed')))`;
const deadline = '(a.deadline=1 AND COALESCE(c.task_done,0)=0 AND a.phishing=0 AND a.spam=0)';
const review = `(${warning} OR j.status='failed' OR (m.id=(${latest}) AND a.confidence IS NOT NULL AND COALESCE(c.category,a.category) IS NULL))`;

export function analysisSearch(operator: string, value: string): { condition: string; bindings: string[] } | null {
	if (operator === 'category') {
		const categories = CATEGORY_GROUPS[value] ?? (isMailCategory(value) ? [value] : null);
		if (!categories) return null;
		return { condition: `EXISTS(SELECT 1 FROM emails m ${joins} WHERE ${active} AND m.id=(${latest}) AND COALESCE(c.category,a.category) IN (${categories.map(()=>'?').join(',')}))`, bindings: [...categories] };
	}
	const predicate = operator === 'risk' ? {
		phishing: '(a.phishing=1 AND COALESCE(c.warning_dismissed,0)=0)',
		spam: '(a.spam=1 AND COALESCE(c.warning_dismissed,0)=0)'
	}[value] : operator === 'needs' ? { reply, deadline, review, attention: `(${reply} OR ${deadline} OR ${review})` }[value] : undefined;
	if (!predicate) return null;
	return { condition: `EXISTS(SELECT 1 FROM emails m ${joins} WHERE ${active} AND ${thread} AND ${predicate})`, bindings: [] };
}

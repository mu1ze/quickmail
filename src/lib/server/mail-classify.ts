import { domainOf, parseEmailAddress } from './email-address';
import { htmlToPreviewText } from '$lib/utils/message-preview';

export const MAX_AUTOMATION_RULES = 30;
export const MAX_RULE_VALUE = 120;
export const CLASSIFY_BODY_CHARS = 1500;

export const RULE_FIELDS = ['from', 'domain', 'subject'] as const;
export const RULE_ACTIONS = ['keep', 'trash'] as const;

export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

export type AutomationRule = {
	id: string;
	field: RuleField;
	value: string;
	action: RuleAction;
};

export type ClassifyInput = {
	from: string;
	subject: string;
	body: string | null | undefined;
};

export type ClassifySource = 'keep_rule' | 'trash_rule' | 'transactional' | 'heuristic' | 'ai' | 'default';

export type ClassifyDecision = {
	action: 'keep' | 'trash';
	reason: string;
	source: ClassifySource;
};

const PROMO_SUBJECT =
	/\b(newsletter|digest|round[- ]?up|recap|% off|\d+%\s*off|coupon|promo(?:tion|tional| code)?|flash sale|limited time|special offer|exclusive (?:deal|offer)|black friday|cyber monday)\b/i;

const PROMO_FROM_LOCAL =
	/^(no[-_]?reply|do[-_]?not[-_]?reply|newsletter|news|marketing|promo(?:tions)?|deals|offers|digest|mailer|updates)\b/i;

const UNSUBSCRIBE =
	/\b(unsubscrib(?:e|ing)|manage (?:email )?preferences|view (?:this )?(?:email )?in (?:a )?browser|you(?:'re| are) receiving this(?: email)? because|this is a promotional)\b/i;

const TRANSACTIONAL =
	/\b(verif(?:y|ication)|confirm(?:ation)? (?:your )?(?:email|account)|one[- ]time(?: password| code)?|\botp\b|2fa|two[- ]factor|authentication code|security code|password reset|reset your password|magic link|invoice|receipt|payment (?:received|failed|confirmed)|order (?:#|confirmed|shipped)|shipped|tracking number|new (?:login|sign[- ]in)|unusual activity|security alert)\b/i;

function isRuleField(value: unknown): value is RuleField {
	return typeof value === 'string' && (RULE_FIELDS as readonly string[]).includes(value);
}

function isRuleAction(value: unknown): value is RuleAction {
	return typeof value === 'string' && (RULE_ACTIONS as readonly string[]).includes(value);
}

/** Strip HTML so classification sees the same words a person would. */
export function classifyBodyText(body: string | null | undefined): string {
	if (!body) return '';
	const text = /<[a-z][\s\S]*>/i.test(body) ? htmlToPreviewText(body) : body;
	return text.replace(/\s+/g, ' ').trim().slice(0, CLASSIFY_BODY_CHARS);
}

export function parseAutomationRules(input: unknown): AutomationRule[] | null {
	if (!Array.isArray(input)) return null;
	if (input.length > MAX_AUTOMATION_RULES) return null;

	const rules: AutomationRule[] = [];
	for (const entry of input) {
		if (!entry || typeof entry !== 'object') return null;
		const row = entry as { id?: unknown; field?: unknown; value?: unknown; action?: unknown };
		if (!isRuleField(row.field) || !isRuleAction(row.action) || typeof row.value !== 'string') {
			return null;
		}
		const value = row.value.trim().slice(0, MAX_RULE_VALUE);
		if (!value) continue;
		const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : crypto.randomUUID();
		rules.push({ id, field: row.field, value, action: row.action });
	}
	return rules;
}

export function ruleMatches(rule: AutomationRule, input: ClassifyInput): boolean {
	const needle = rule.value.trim().toLowerCase();
	if (!needle) return false;

	if (rule.field === 'subject') {
		return input.subject.toLowerCase().includes(needle);
	}

	const address = parseEmailAddress(input.from);
	if (rule.field === 'from') {
		return address.includes(needle) || input.from.toLowerCase().includes(needle);
	}

	const domain = domainOf(input.from);
	if (!domain) return false;
	return domain === needle || domain.endsWith(`.${needle}`);
}

/** Keep rules win so a protected sender never hits promo heuristics. */
export function matchAutomationRules(
	input: ClassifyInput,
	rules: readonly AutomationRule[]
): ClassifyDecision | null {
	for (const rule of rules) {
		if (rule.action !== 'keep' || !ruleMatches(rule, input)) continue;
		return {
			action: 'keep',
			reason: `Rule: keep when ${rule.field} matches “${rule.value}”`,
			source: 'keep_rule'
		};
	}
	for (const rule of rules) {
		if (rule.action !== 'trash' || !ruleMatches(rule, input)) continue;
		return {
			action: 'trash',
			reason: `Rule: trash when ${rule.field} matches “${rule.value}”`,
			source: 'trash_rule'
		};
	}
	return null;
}

export function isTransactionalKeep(input: ClassifyInput): boolean {
	const haystack = `${input.subject}\n${classifyBodyText(input.body)}`;
	return TRANSACTIONAL.test(haystack);
}

export function heuristicClassify(input: ClassifyInput): ClassifyDecision {
	if (isTransactionalKeep(input)) {
		return { action: 'keep', reason: 'Looks like a receipt, login, or shipping notice', source: 'transactional' };
	}

	const subject = input.subject;
	const body = classifyBodyText(input.body);
	const local = parseEmailAddress(input.from).split('@')[0] ?? '';

	const promoSubject = PROMO_SUBJECT.test(subject);
	const promoFrom = PROMO_FROM_LOCAL.test(local);
	const unsubscribe = UNSUBSCRIBE.test(body) || UNSUBSCRIBE.test(subject);

	if (promoSubject || (unsubscribe && (promoFrom || promoSubject || /\bsale\b|\bdeal\b/i.test(subject)))) {
		return { action: 'trash', reason: 'Looks like a newsletter or promotion', source: 'heuristic' };
	}

	if (unsubscribe && promoFrom) {
		return { action: 'trash', reason: 'Looks like bulk marketing mail', source: 'heuristic' };
	}

	return { action: 'keep', reason: 'No promo signals', source: 'default' };
}

/**
 * Parse a model reply. Anything other than an explicit `trash` is keep.
 * Markdown fences and extra prose are ignored.
 */
export function parseAiClassifyResponse(raw: unknown): ClassifyDecision | null {
	const text = extractAiText(raw);
	if (!text) return null;

	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) return null;

	try {
		const parsed = JSON.parse(jsonMatch[0]) as { action?: unknown; reason?: unknown };
		if (parsed.action !== 'trash' && parsed.action !== 'keep') return null;
		const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 160) : '';
		if (parsed.action === 'trash') {
			return { action: 'trash', reason: reason || 'Model marked this as unimportant', source: 'ai' };
		}
		return { action: 'keep', reason: reason || 'Model kept this', source: 'ai' };
	} catch {
		return null;
	}
}

export function extractAiText(raw: unknown): string | null {
	if (typeof raw === 'string') return raw.trim() || null;
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as { response?: unknown; result?: unknown };
	if (typeof record.response === 'string') return record.response.trim() || null;
	if (typeof record.result === 'string') return record.result.trim() || null;
	return null;
}

export async function classifyOpenedMail(
	input: ClassifyInput,
	options: {
		rules: readonly AutomationRule[];
		classifyWithAi?: (input: ClassifyInput) => Promise<ClassifyDecision | null>;
	}
): Promise<ClassifyDecision> {
	const fromRule = matchAutomationRules(input, options.rules);
	if (fromRule) return fromRule;

	const heuristic = heuristicClassify(input);
	if (heuristic.action === 'keep' && heuristic.source === 'transactional') {
		return heuristic;
	}
	if (heuristic.action === 'trash') {
		return heuristic;
	}

	if (options.classifyWithAi) {
		const ai = await options.classifyWithAi(input);
		if (ai?.action === 'trash') return ai;
	}

	return heuristic;
}

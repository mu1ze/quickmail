import { htmlToTextLines, looksLikeHtml } from './utils/message-preview';

/**
 * Pulls the one-time code out of sign-in and verification mail, so the inbox
 * row, the reader and the notification can show it without opening anything.
 * Runs on the server and in the browser; no network, no storage.
 */

/** Mail has to read like a sign-in or verification before any number counts. */
const CONTEXT =
	/\b(?:verif\w*|confirm\w*|sign[- ]?in|log[- ]?in|login|one[- ]time|single[- ]use|otp|passcode|2fa|two[- ](?:factor|step)|mfa|authenticat\w*|security code|access code|reset)\b/i;

/** The word a code sits next to. */
const KEYWORD = /\b(?:pass ?code|codes?|otp|pin|one[- ]time password|token)\b/gi;

/** Weaker cue right before the code: "Enter 7391 to continue". */
const VERB = /\b(?:enter|type|use)\b/gi;

/** "Promo code", "zip code" and friends are not sign-in codes. */
const NOT_A_CODE_BEFORE = /\b(?:promo(?:tional)?|discount|coupon|zip|postal|referral|gift|voucher|source|error|status|area|country|tracking|reference|qr|bar|dress|tax|product)\s*$/i;
const NOT_A_CODE_AFTER = /^\s*(?:of conduct|review|block|snippet)\b/i;

/**
 * 4–8 digits, "123 456" / "123-456", or 5–8 capitals with at least one digit.
 * The edges keep out prices, order numbers, dates, times, phone numbers and
 * pieces of addresses or URLs.
 */
const CANDIDATE =
	/(?<![\w$€£¥#@/.:+-])(\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8})(?![\w@%/]|[.,:]\d|-\d)/g;

const UNIT_AFTER = /^\s*(?:min(?:ute)?s?|hours?|hrs?|sec(?:ond)?s?|days?|px|usd|cad|eur|gbp|points?|items?)\b/i;
const YEAR = /^(?:19|20)\d\d$/;

const SCAN_LIMIT = 6000;

type Scored = { code: string; score: number; index: number };

type Span = { start: number; end: number; weak?: boolean };

function keywordSpans(text: string): Span[] {
	const spans: Span[] = [];
	for (const match of text.matchAll(VERB)) {
		const start = match.index ?? 0;
		spans.push({ start, end: start + match[0].length, weak: true });
	}
	for (const match of text.matchAll(KEYWORD)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (NOT_A_CODE_BEFORE.test(text.slice(Math.max(0, start - 24), start))) continue;
		if (NOT_A_CODE_AFTER.test(text.slice(end, end + 20))) continue;
		spans.push({ start, end });
	}
	return spans;
}

function scoreCandidates(text: string, bonus: number): Scored[] {
	const spans = keywordSpans(text);
	if (spans.length === 0) return [];
	const scored: Scored[] = [];
	for (const match of text.matchAll(CANDIDATE)) {
		const raw = match[1];
		const start = match.index ?? 0;
		const end = start + raw.length;
		if (UNIT_AFTER.test(text.slice(end, end + 12))) continue;
		if (/(?:©|copyright)\s*$/i.test(text.slice(Math.max(0, start - 12), start))) continue;

		// Closest keyword: "code: 123456" reads tighter than "123456 is your code".
		let best = -Infinity;
		for (const span of spans) {
			if (span.weak) {
				if (span.end <= start && start - span.end <= 12) best = Math.max(best, 60 - (start - span.end));
				continue;
			}
			if (span.end <= start && start - span.end <= 80) best = Math.max(best, 100 - (start - span.end));
			else if (span.start >= end && span.start - end <= 40) best = Math.max(best, 90 - (span.start - end));
		}
		if (best === -Infinity) continue;

		const lineStart = text.lastIndexOf('\n', start - 1) + 1;
		const lineEnd = text.indexOf('\n', end);
		const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
		if (line === raw) best += 20;
		if (YEAR.test(raw)) best -= 40;

		const code = raw.replace(/[ -]/g, '');
		scored.push({ code, score: best + bonus, index: start });
	}
	return scored;
}

/** Plain text of a message, preferring the text part, capped for speed. */
export function messageText(bodyText: string | null | undefined, bodyHtml?: string | null): string {
	const text = bodyText?.trim() && !looksLikeHtml(bodyText) ? bodyText : bodyHtml?.trim() ? htmlToTextLines(bodyHtml) : (bodyText ?? '');
	return text.slice(0, SCAN_LIMIT);
}

export function findVerificationCode(input: {
	subject?: string | null;
	text?: string | null;
	html?: string | null;
}): string | null {
	const subject = (input.subject ?? '').slice(0, 300);
	const text = messageText(input.text, input.html);
	if (!CONTEXT.test(subject) && !CONTEXT.test(text.slice(0, 2000))) return null;

	const candidates = [...scoreCandidates(subject, 30), ...scoreCandidates(text, 0)];
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.score - a.score || a.index - b.index);
	const top = candidates[0];
	return top.score >= 40 ? top.code : null;
}

/** "482913" → "482 913", easier to read and type; letter codes stay as sent. */
export function formatVerificationCode(code: string): string {
	return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Codes expire within minutes; after a day the row stops showing them. */
export const VERIFICATION_CODE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Cheap check on what the list already has, before reading any bodies. */
export function mightHaveVerificationCode(subject: string | null | undefined, preview: string | null | undefined): boolean {
	const text = `${subject ?? ''} ${preview ?? ''}`;
	return CONTEXT.test(text) || /\b(?:pass ?code|codes?|otp|pin)\b/i.test(text);
}

/** D1 stores "2026-10-17 14:02:11" in UTC. */
export function isRecentForCode(createdAt: string, now = Date.now()): boolean {
	const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
	return Number.isFinite(time) && now - time < VERIFICATION_CODE_WINDOW_MS;
}

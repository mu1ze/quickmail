import { ANALYSIS_QUESTIONS, CATEGORY_DEFINITIONS, SUBQ_MODEL, isMailCategory, type AnalysisAnswers } from '$lib/mail-analysis';
import { htmlToPlainText } from '$lib/utils/html';

export type AnalysisMetadata = {
	replyTo?: string; date?: string; envelopeFrom?: string;
	visibleTo?: string[]; visibleCc?: string[];
	hasListUnsubscribe?: boolean; listId?: string; autoSubmitted?: string; precedence?: string;
	authResults?: string; provider?: 'cloudflare' | 'resend';
	attachments?: { filename: string; type: string }[];
};
export function inboundAnalysisMetadata(headers: Headers | Record<string, string>, provider: 'cloudflare' | 'resend', extra: Partial<AnalysisMetadata> = {}): AnalysisMetadata {
	const h = headers instanceof Headers ? headers : new Headers(headers);
	const read = (name: string, max = 500) => h.get(name)?.slice(0, max) || undefined;
	return { ...extra, provider, replyTo: read('reply-to'), date: read('date'),
		hasListUnsubscribe: h.has('list-unsubscribe'), listId: read('list-id'),
		autoSubmitted: read('auto-submitted'), precedence: read('precedence', 40), authResults: read('authentication-results', 1500) };
}

/** Remove tracking/credential parameters but keep destination identity and path. */
function safeUrl(raw: string): string {
	try {
		const url = new URL(raw);
		if (!['https:', 'http:'].includes(url.protocol)) return '[non-web link]';
		url.username = ''; url.password = ''; url.search = ''; url.hash = '';
		url.pathname = url.pathname.split('/').map(part => part.length > 64 ? '[token]' : part).join('/');
		return url.toString().slice(0, 500);
	} catch { return '[invalid link]'; }
}
function redact(text: string): string {
	return text.replace(/https?:\/\/[^\s<>"']+/gi, safeUrl)
		.replace(/\b((?:verification|security|authentication|one[- ]time|otp)\s*(?:code|password)?\s*(?:is|:)?\s*)\d{4,8}\b/gi, '$1[code]');
}
function latestBody(text: string, forwarded: boolean): string {
	const lines = text.split(/\r?\n/);
	// Forwarded material can be the current message's essential evidence.
	if (forwarded) return text.trim();
	const boundary = lines.findIndex((line,index) => /^\s*(?:On\b.*wrote:|>{1,}|-{2,}\s*Original Message|--\s*$)/i.test(line) ||
		(/^\s*On\b/i.test(line) && /wrote:\s*$/i.test(`${line} ${lines[index+1]??''}`)));
	const own = boundary >= 0 ? lines.slice(0, boundary).join('\n').trim() : text.trim();
	return own || text.trim();
}
export function buildAnalysisState(input: {
	from: string; fromName?: string | null; to: string; cc?: string | null;
	subject: string; bodyText?: string | null; bodyHtml?: string | null; metadata?: AnalysisMetadata;
}) {
	const metadata = input.metadata ?? {};
	const forwarded = /^\s*(?:fw|fwd|forward)\s*:/i.test(input.subject);
	let html = input.bodyHtml ?? '';
	const quote = /<(?:blockquote\b|[^>]+(?:class=["'][^"']*(?:gmail_quote|yahoo_quoted)|id=["']?(?:appendonsend|divRplyFwdMsg)))/i.exec(html);
	if (!forwarded && quote && htmlToPlainText(html.slice(0, quote.index)).trim()) html = html.slice(0, quote.index);
	html = html.replace(/<(?:script|style|head)\b[^>]*>[\s\S]*?<\/(?:script|style|head)>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
	const links: { text: string; destination: string }[] = [];
	for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
		if (links.length >= 20) break;
		links.push({ text: redact(htmlToPlainText(match[4])).slice(0, 200), destination: safeUrl(htmlToPlainText(match[1] ?? match[2] ?? match[3])) });
	}
	const plain = input.bodyText?.trim();
	// Some providers put CSS into their flattened text alternative.
	const polluted = html && plain && /\{[^{}]{0,80}(?:text-decoration|font-[\w-]+|background[\w-]*|display|color)\s*:/i.test(plain);
	const source = plain && !polluted ? plain : htmlToPlainText(html);
	const body = latestBody(source ?? '', forwarded);
	return {
		headers: {
			from_name: (input.fromName ?? '').slice(0, 200), from_addr: input.from.slice(0, 500),
			to: (metadata.visibleTo?.join(', ') ?? input.to).slice(0, 1000),
			cc: (metadata.visibleCc?.join(', ') ?? input.cc ?? '').slice(0, 1000),
			recipient: input.to.slice(0,500), subject: redact(input.subject).slice(0, 500),
			reply_to: metadata.replyTo ?? null, date: metadata.date ?? null,
			envelope_from: metadata.envelopeFrom ?? null, has_list_unsubscribe: metadata.hasListUnsubscribe ?? null,
			list_id: metadata.listId ?? null, auto_submitted: metadata.autoSubmitted ?? null,
			// Raw Authentication-Results may have been injected by a sender. No trust assertion.
			auth_results: { value: metadata.authResults ?? null, provenance: metadata.provider ?? 'unavailable', verified: false },
			attachments: (metadata.attachments ?? []).slice(0, 20).map(a => ({ filename: a.filename.slice(0, 200), type: a.type.slice(0, 100) }))
		},
		body: redact(body).slice(0, 6000), truncated: body.length > 6000, links,
		subscription_preferences: 'unknown'
	};
}

function probability(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1; }
function record(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function distribution(value: unknown, keys: string[]): boolean {
	return record(value) && Object.keys(value).length === keys.length && keys.every(k => probability(value[k])) && Math.abs(Object.values(value).reduce<number>((sum, p) => sum + Number(p), 0) - 1) < 0.02;
}
export function parseSubqResponse(raw: unknown): { answers: AnalysisAnswers; inputTokens: number } | null {
	if (!record(raw) || raw.model !== SUBQ_MODEL || !record(raw.answers) || !record(raw.usage)) return null;
	const a = raw.answers, f = a.folder, u = a.urgency;
	if (!record(f) || f.type !== 'choice' || !isMailCategory(f.choice) || !probability(f.confidence) || !distribution(f.probabilities, Object.keys(CATEGORY_DEFINITIONS))) return null;
	if (!record(u) || u.type !== 'score' || typeof u.score !== 'number' || !Number.isFinite(u.score) || u.score < 0 || u.score > 2 || !probability(u.confidence) || !distribution(u.probabilities, ['0','1','2']) || !record(u.legend) || Object.keys(u.legend).sort().join(',') !== '0,1,2' || !Object.values(u.legend).every(v => typeof v === 'string')) return null;
	for (const key of ['needs_reply', 'phishing', 'deadline', 'spam']) {
		const answer = a[key]; if (!record(answer) || answer.type !== 'noul' || !probability(answer.noul)) return null;
	}
	const tokens = raw.usage.input_tokens;
	if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0 || raw.usage.output_tokens !== 0) return null;
	return { answers: a as unknown as AnalysisAnswers, inputTokens: tokens };
}
export class SubqError extends Error {
	constructor(public code: string, public retryable: boolean, public retryAfterSeconds = 0) { super(code); }
}
export async function requestSubq(key: string, state: ReturnType<typeof buildAnalysisState>, fetcher: typeof fetch = fetch) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await fetcher('https://api.subq.ai/v1/systemone', {
			method: 'POST', signal: controller.signal,
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: SUBQ_MODEL, state, questions: ANALYSIS_QUESTIONS })
		});
		if (!res.ok) {
			const retry = res.headers.get('retry-after');
			const delay = retry ? Number(retry) || Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 0;
			throw new SubqError(`subq_http_${res.status}`, res.status === 429 || res.status >= 500, Number.isFinite(delay) ? Math.max(0, Math.min(3600, delay)) : 0);
		}
		const parsed = parseSubqResponse(await res.json().catch(() => null));
		if (!parsed) throw new SubqError('subq_invalid_response', false);
		return parsed;
	} catch (error) {
		if (error instanceof SubqError) throw error;
		// Never expose provider payloads, subjects, addresses, or credentials in errors.
		throw new SubqError('subq_network_or_timeout', true);
	} finally { clearTimeout(timer); }
}

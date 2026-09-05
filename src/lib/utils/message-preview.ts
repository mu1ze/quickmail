import { stripQuotedText } from './quotes';

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
			const code = Number.parseInt(hex, 16);
			return Number.isFinite(code) ? String.fromCharCode(code) : '';
		})
		.replace(/&#(\d+);/g, (_, code) => {
			const number = Number(code);
			return Number.isFinite(number) ? String.fromCharCode(number) : '';
		});
}

/** Stop unclosed blocks at body markup so a missing </head> cannot eat the message. */
const BEFORE_BODY = '(?=<body\\b)|$';

/**
 * Markup that should never leak into a mailbox snippet: comments, Outlook
 * conditionals, or ordinary tags. Comparison operators and lone entities
 * are not HTML.
 */
export function looksLikeHtml(value: string): boolean {
	return /<!--|<!\[|<!doctype|<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>|<o:p|\sxmlns:/i.test(value);
}

function looksLikeCssBlock(inner: string): boolean {
	return /[;:]/.test(inner) || /#[0-9a-f]{3,8}\b/i.test(inner) || /\d+(?:px|em|rem|%)/i.test(inner);
}

/** CSS leftovers and tracking URLs — only for the HTML path. */
function tidyHtmlPreviewText(value: string): string {
	return value
		.replace(/<!--+|--+>/g, ' ')
		.replace(/\[if[^\]]*\]/gi, ' ')
		.replace(/\[endif\]/gi, ' ')
		.replace(/\{([^{}]{0,400})\}/g, (match, inner: string) => (looksLikeCssBlock(inner) ? ' ' : match))
		.replace(/https?:\/\/[^\s)]+/gi, ' ')
		.replace(/\(\s*\)/g, ' ')
		.replace(/[<>]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Outlook truncation and leftover CSS, not short real replies. */
function isLeftoverMarkup(text: string): boolean {
	if (!text) return true;
	if (/^[A-Za-z]\.{2,}$/.test(text)) return true;
	if (/[{}]/.test(text) && looksLikeCssBlock(text)) return true;
	return false;
}

/** Turn a stored HTML fragment into readable words for a mailbox snippet. */
export function htmlToPreviewText(html: string): string {
	const text = html
		.replace(new RegExp(`<style\\b[^>]*>[\\s\\S]*?(?:</style>|${BEFORE_BODY})`, 'gi'), ' ')
		.replace(new RegExp(`<script\\b[^>]*>[\\s\\S]*?(?:</script>|${BEFORE_BODY})`, 'gi'), ' ')
		.replace(/<head\b[^>]*>[\s\S]*?(?:<\/head>|(?=<body\b))/gi, ' ')
		.replace(new RegExp(`<noscript\\b[^>]*>[\\s\\S]*?(?:</noscript>|${BEFORE_BODY})`, 'gi'), ' ')
		.replace(new RegExp(`<!--\\[if[\\s\\S]*?(?:<!\\[endif\\]-->|(?=<body\\b)|$)`, 'gi'), ' ')
		.replace(new RegExp(`<!\\[if[\\s\\S]*?(?:<!\\[endif\\]>|(?=<body\\b)|$)`, 'gi'), ' ')
		.replace(new RegExp(`<!--[\\s\\S]*?(?:-->|(?=<body\\b)|$)`, 'g'), ' ')
		.replace(/<!\[endif\]-->?/gi, ' ')
		.replace(/<!doctype[^>]*>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|td|th|h[1-6]|li|blockquote)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ');

	const decoded = decodeEntities(text).replace(/<[^>]+>/g, ' ');
	return tidyHtmlPreviewText(decoded);
}

/** Newest message's own words — quoted history and markup are dropped. */
export function buildMessagePreview(bodyHead: string | null | undefined): string {
	if (!bodyHead) return '';
	const html = looksLikeHtml(bodyHead);
	const source = html ? htmlToPreviewText(bodyHead) : bodyHead;
	const text = stripQuotedText(source).replace(/\s+/g, ' ').trim().slice(0, 220);
	if (html && isLeftoverMarkup(text)) return '';
	return text;
}

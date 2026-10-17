import { stripQuotedText } from './quotes';

function decodeEntities(value: string): string {
	const decodeCodePoint = (code: number) => Number.isInteger(code) && code >= 0 && code <= 0x10ffff &&
		!(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
	return value
		.replace(/&(?:zwnj|zwj|shy|ZeroWidthSpace);/gi, '')
		.replace(/&(?:ndash|mdash);/gi, '—')
		.replace(/&(?:lsquo|rsquo);/gi, "'")
		.replace(/&(?:ldquo|rdquo);/gi, '"')
		.replace(/&hellip;/gi, '…')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
			const code = Number.parseInt(hex, 16);
			return decodeCodePoint(code);
		})
		.replace(/&#(\d+);/g, (_, code) => {
			const number = Number(code);
			return decodeCodePoint(number);
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

/** Some providers flatten style elements into their text alternative. */
function stripCssRules(text: string): string {
	return text.replace(/(?:^|[\s}])((?:[.#][\w-]+|(?:html|body|a|p|div|span|table|tr|td|th|img|h[1-6]|ul|ol|li)\b)(?:[.#:][\w-]+|\[[^\]\n]*\])*(?:\s*[>+~,]\s*[.#]?[\w-]+(?:[.#:][\w-]+|\[[^\]\n]*\])*)?)\s*\{([^{}]{0,4000})\}/gi,
		(match, _selector: string, declarations: string) =>
			/(?:^|;)\s*(?:--[\w-]+|(?:text|font|background|border|margin|padding|display|color|width|height|line|position|overflow|visibility|opacity)[\w-]*)\s*:/i.test(declarations)
				? ' ' : match);
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
		.replace(/[\u200b-\u200d\ufeff\u00ad]/g, '')
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n+/g, '\n')
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
function previewHtmlLines(html: string): string {
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

/** Readable text with line breaks kept, for scanning a message's content. */
export function htmlToTextLines(html: string): string {
	return previewHtmlLines(html);
}

export function htmlToPreviewText(html: string): string {
	return previewHtmlLines(html).replace(/\s+/g, ' ').trim();
}

/** Newest message's own words — quoted history and markup are dropped. */
export function buildMessagePreview(bodyHead: string | null | undefined, bodyHtml?: string | null): string {
	// The original HTML still distinguishes hidden styles from visible words,
	// unlike a provider's already-flattened text alternative.
	if (bodyHtml?.trim()) {
		const fromHtml = buildMessagePreview(bodyHtml);
		if (fromHtml) return fromHtml;
	}
	if (!bodyHead) return '';
	const html = looksLikeHtml(bodyHead);
	let body = bodyHead;
	if (html) {
		// Cut quoted HTML before whitespace normalization erases line boundaries.
		const boundary = /<blockquote\b|<[^>]+(?:class\s*=\s*["'][^"']*(?:gmail_quote|yahoo_quoted)|id\s*=\s*["']?(?:appendonsend|divRplyFwdMsg))/i.exec(body);
		if (boundary && htmlToPreviewText(body.slice(0, boundary.index))) body = body.slice(0, boundary.index);
	}
	const source = stripCssRules(html ? previewHtmlLines(body) : body);
	const text = stripQuotedText(source).replace(/\s+/g, ' ').trim().slice(0, 220);
	if (html && isLeftoverMarkup(text)) return '';
	return text;
}

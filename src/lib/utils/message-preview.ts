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

/**
 * Markup that should never leak into a mailbox snippet: comments, Outlook
 * conditionals, a truncated <style> block, or ordinary tags.
 */
export function looksLikeHtml(value: string): boolean {
	return /<!--|<!\[|<\/?[a-z!]|\sxmlns:|<o:p|&nbsp;|&lt;/i.test(value);
}

/** Turn a stored HTML fragment into readable words for a mailbox snippet. */
export function htmlToPreviewText(html: string): string {
	const text = html
		// Truncated snippets often cut through <style> / <head>, dumping CSS.
		.replace(/<style[\s\S]*?(?:<\/style>|$)/gi, ' ')
		.replace(/<script[\s\S]*?(?:<\/script>|$)/gi, ' ')
		.replace(/<head[\s\S]*?(?:<\/head>|$)/gi, ' ')
		.replace(/<noscript[\s\S]*?(?:<\/noscript>|$)/gi, ' ')
		.replace(/<!--\[if[\s\S]*?(?:<!\[endif\]-->|$)/gi, ' ')
		.replace(/<!\[if[\s\S]*?(?:<!\[endif\]>|$)/gi, ' ')
		.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
		.replace(/<!\[endif\]-->?/gi, ' ')
		.replace(/<!doctype[^>]*>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|td|th|h[1-6]|li|blockquote)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ');

	return tidyPreviewText(decodeEntities(text));
}

function tidyPreviewText(value: string): string {
	return value
		.replace(/<!--+|--+>/g, ' ')
		.replace(/\[if[^\]]*\]/gi, ' ')
		.replace(/\[endif\]/gi, ' ')
		.replace(/\{[^{}]{0,400}\}/g, ' ')
		.replace(/https?:\/\/[^\s)]+/gi, ' ')
		.replace(/\(\s*\)/g, ' ')
		.replace(/[<>]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isReadablePreview(text: string): boolean {
	const letters = (text.match(/\p{L}/gu) ?? []).length;
	if (letters >= 12) return true;
	if (letters < 3) return false;
	return letters / text.length >= 0.45;
}

/** Newest message's own words — quoted history and markup are dropped. */
export function buildMessagePreview(bodyHead: string | null | undefined): string {
	if (!bodyHead) return '';
	const source = looksLikeHtml(bodyHead) ? htmlToPreviewText(bodyHead) : bodyHead;
	let text = tidyPreviewText(stripQuotedText(source));
	if (looksLikeHtml(text)) text = htmlToPreviewText(text);
	text = text.slice(0, 220).trim();
	return isReadablePreview(text) ? text : '';
}

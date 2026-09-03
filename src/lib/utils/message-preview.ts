import { stripQuotedText } from './quotes';

/** Turn a stored HTML fragment into readable words for a mailbox snippet. */
export function htmlToPreviewText(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|h[1-6]|li|blockquote)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/\s+/g, ' ')
		.trim();
}

function looksLikeHtml(value: string): boolean {
	return /<[a-z][\s\S]*>/i.test(value);
}

/** Newest message's own words — quoted history and markup are dropped. */
export function buildMessagePreview(bodyHead: string | null | undefined): string {
	if (!bodyHead) return '';
	const text = looksLikeHtml(bodyHead) ? htmlToPreviewText(bodyHead) : bodyHead;
	return stripQuotedText(text).replace(/\s+/g, ' ').trim().slice(0, 220);
}

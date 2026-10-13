import DOMPurify from 'dompurify';
import { attachmentHref, isImageType } from './attachments';
import type { EmailAttachmentMeta } from '$lib/types';

function contentId(value: string): string {
	try { value = decodeURIComponent(value); } catch { /* Some senders use literal %. */ }
	return value.trim().replace(/^<|>$/g, '');
}

/** Preserve email layouts while removing navigation and executable markup. */
export function prepareEmailHtml(html: string, emailId: string, attachments: EmailAttachmentMeta[]): string {
	const clean = DOMPurify.sanitize(html, {
		WHOLE_DOCUMENT: true,
		FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'link'],
		FORBID_ATTR: ['srcdoc', 'autofocus']
	});
	const doc = new DOMParser().parseFromString(clean, 'text/html');
	const sources = new Map(attachments.filter((file) => file.content_id && isImageType(file.content_type))
		.map((file) => [contentId(file.content_id!), new URL(attachmentHref(emailId, file.id), window.location.origin).href]));
	const resolve = (value: string) => {
		if (!/^cid:/i.test(value)) return value;
		return sources.get(contentId(value.slice(4))) ?? '';
	};
	for (const element of doc.querySelectorAll('[src], [poster], [background]')) {
		for (const attr of ['src', 'poster', 'background']) {
			const value = element.getAttribute(attr);
			if (value && /^cid:/i.test(value)) {
				const source = resolve(value);
				if (source) element.setAttribute(attr, source);
				else element.removeAttribute(attr);
			}
		}
	}
	const resolveCss = (css: string) => css.replace(/url\(\s*["']?(cid:[^\s)'" ]+)["']?\s*\)/gi,
		(_, cid: string) => `url("${resolve(cid)}")`);
	for (const element of doc.querySelectorAll('[style]')) {
		element.setAttribute('style', resolveCss(element.getAttribute('style') ?? ''));
	}
	for (const style of doc.querySelectorAll('style')) style.textContent = resolveCss(style.textContent ?? '');
	for (const link of Array.from(doc.links)) {
		if (!/^(https?:|mailto:|tel:)/i.test(link.getAttribute('href') ?? '')) link.removeAttribute('href');
		link.setAttribute('target', '_blank');
		link.setAttribute('rel', 'noopener noreferrer');
	}
	for (const media of doc.querySelectorAll('audio, video')) {
		media.removeAttribute('autoplay');
		media.setAttribute('controls', '');
		media.setAttribute('preload', 'none');
	}
	return doc.documentElement.outerHTML;
}

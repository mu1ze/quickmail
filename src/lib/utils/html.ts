export function htmlToPlainText(html: string): string {
	// The composer also renders on the server, where DOMParser is unavailable.
	if (typeof DOMParser === 'undefined') {
		return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
			.replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
			.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
			.replace(/\n{3,}/g, '\n\n').trim();
	}
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const node of doc.querySelectorAll('style, script')) node.remove();
	for (const node of doc.querySelectorAll('br')) node.replaceWith('\n');
	for (const node of doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote')) node.append('\n');
	return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function isHtmlEmpty(html: string): boolean {
	const text = htmlToPlainText(html);
	return !text && !/<(?:img|video|audio)\b/i.test(html);
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

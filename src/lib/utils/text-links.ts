export type TextPart = { text: string; href?: string };

/** Links stay structured so message text never needs to be injected as HTML. */
export function textParts(value: string): TextPart[] {
	const parts: TextPart[] = [];
	const links = /https?:\/\/[^\s<>]+|\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
	let offset = 0;
	for (const match of value.matchAll(links)) {
		const start = match.index!;
		if (start > offset) parts.push({ text: value.slice(offset, start) });
		let label = match[0].replace(/[.,;:!?]+$/, '');
		// Keep balanced parentheses in URLs, but leave surrounding prose outside.
		while (label.endsWith(')') && (label.match(/\)/g)?.length ?? 0) > (label.match(/\(/g)?.length ?? 0)) label = label.slice(0, -1);
		const href = label.includes('://') ? label : `mailto:${label}`;
		parts.push({ text: label, href });
		offset = start + label.length;
	}
	if (offset < value.length) parts.push({ text: value.slice(offset) });
	return parts;
}

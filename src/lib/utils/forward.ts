/** Prefix a forwarded subject without stacking Fwd: Fwd:. */
export function withForwardPrefix(subject: string): string {
	const trimmed = subject.trim() || '(no subject)';
	return /^\s*(fwd|fw)\s*:/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

export function escapeForwardHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Empty editor above a quoted copy of the original, ready to send onward. */
export function buildForwardBody(input: {
	from: string;
	to: string;
	cc?: string | null;
	subject: string;
	date: string;
	bodyHtml?: string | null;
	bodyText?: string | null;
}): string {
	const lines = [
		`From: ${escapeForwardHtml(input.from)}`,
		`Date: ${escapeForwardHtml(input.date)}`,
		`Subject: ${escapeForwardHtml(input.subject)}`,
		`To: ${escapeForwardHtml(input.to)}`
	];
	if (input.cc?.trim()) lines.push(`Cc: ${escapeForwardHtml(input.cc)}`);

	const quoted =
		input.bodyHtml?.trim() ||
		escapeForwardHtml(input.bodyText ?? '').replaceAll('\n', '<br>\n');

	return `<p></p>
<div>
<p>---------- Forwarded message ----------<br>
${lines.join('<br>\n')}</p>
${quoted}
</div>`;
}

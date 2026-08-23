import {
	compileSignature,
	isSignatureEmpty,
	parseSignatureConfig,
	serializeSignatureConfig
} from './signature-template';

export const MAX_EMAIL_SIGNATURE_LENGTH = 4000;

export {
	compileSignature,
	parseSignatureConfig,
	serializeSignatureConfig,
	type SignatureConfig,
	type SignatureLayout
} from './signature-template';

/** Keep intentional line breaks while removing transport and trailing whitespace noise. */
export function normalizeEmailSignature(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

/** Mailbox sign-off wins when set; otherwise the account signature. */
export function pickEmailSignature(
	mailbox: string | null | undefined,
	account: string | null | undefined
): string {
	const mailboxConfig = parseSignatureConfig(mailbox ?? '');
	if (!isSignatureEmpty(mailboxConfig)) {
		return serializeSignatureConfig(mailboxConfig);
	}
	const accountConfig = parseSignatureConfig(account ?? '');
	if (!isSignatureEmpty(accountConfig)) {
		return serializeSignatureConfig(accountConfig);
	}
	return '';
}

/**
 * Empty input becomes null so the mailbox falls back to the account signature.
 * Structured templates are stored as compact JSON; a plain-only sign-off stays text.
 */
export function parseMailboxSignature(value: string): string | null {
	if (value.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	const signature = serializeSignatureConfig(parseSignatureConfig(value));
	if (signature.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	return signature || null;
}

/** Canonical stored form for the account signature. Empty string clears it. */
export function parseAccountSignature(value: string): string {
	if (value.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	const signature = serializeSignatureConfig(parseSignatureConfig(value));
	if (signature.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	return signature;
}

/** Append the configured sign-off to both MIME alternatives exactly once at send time. */
export function appendEmailSignature(input: {
	text: string;
	html: string | null;
	signature: string;
	/** Public origin used to rewrite hosted photo/logo paths into absolute URLs. */
	origin?: string;
}): { text: string; html: string | null } {
	const compiled = compileSignature(parseSignatureConfig(input.signature), input.origin ?? '');
	if (!compiled.text && !compiled.html) return { text: input.text, html: input.html };

	const text = `${input.text.trimEnd()}\n\n${compiled.text}`;
	const html = input.html
		? `${input.html.trimEnd()}\n<div><br></div>\n<div data-email-signature="true">${compiled.html}</div>`
		: null;

	return { text, html };
}

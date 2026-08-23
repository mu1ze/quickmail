import {
	compileSignature,
	isSignatureEmpty,
	parseSignatureConfig,
	serializeSignatureConfig
} from './signature-template';

export const MAX_EMAIL_SIGNATURE_LENGTH = 4000;
export const MAX_SAVED_SIGNATURES = 5;
export const MAX_SIGNATURE_NAME_LENGTH = 40;

export type SavedSignature = {
	id: string;
	name: string;
	body: string;
	is_default: boolean;
	position: number;
};

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

export function parseSignatureName(value: string): string {
	const name = value.trim().replace(/\s+/g, ' ').slice(0, MAX_SIGNATURE_NAME_LENGTH);
	return name || 'Signature';
}

/** Which library entry to select in the composer for this From address. */
export function defaultComposeSignatureId(
	signatures: SavedSignature[],
	mailboxSignatureId?: string | null
): string {
	if (mailboxSignatureId && signatures.some((signature) => signature.id === mailboxSignatureId)) {
		return mailboxSignatureId;
	}
	return signatures.find((signature) => signature.is_default)?.id ?? signatures[0]?.id ?? '';
}

/**
 * Resolve the body that should be appended.
 * `selectedId` undefined = mailbox pin, then mailbox body, then account default.
 * `selectedId` empty/null = omit. Otherwise the matching library entry.
 */
export function resolveSignatureBody(input: {
	signatures: SavedSignature[];
	selectedId?: string | null;
	mailboxSignatureId?: string | null;
	mailboxBody?: string | null;
}): string {
	const { signatures } = input;
	if (input.selectedId !== undefined) {
		if (!input.selectedId) return '';
		return signatures.find((signature) => signature.id === input.selectedId)?.body ?? '';
	}
	if (input.mailboxSignatureId) {
		const pinned = signatures.find((signature) => signature.id === input.mailboxSignatureId);
		if (pinned) return pinned.body;
	}
	const fallback =
		signatures.find((signature) => signature.is_default)?.body ?? signatures[0]?.body ?? '';
	return pickEmailSignature(input.mailboxBody, fallback);
}

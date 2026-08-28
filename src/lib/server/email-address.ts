export function parseEmailAddress(value: string): string {
	const trimmed = value.trim();
	const bracketMatch = trimmed.match(/<([^>]+)>/);
	if (bracketMatch) {
		return bracketMatch[1].toLowerCase().trim();
	}

	const emailMatch = trimmed.match(/[^\s<>]+@[^\s<>]+/);
	return (emailMatch?.[0] ?? trimmed).toLowerCase().trim();
}

/**
 * Address to store and display for inbound mail.
 *
 * Cloudflare Email Workers set `message.from` to the SMTP envelope sender
 * (MAIL FROM / Return-Path). Providers like Paystack put a VERP bounce mailbox
 * there (`bounces+id-user=domain@em.example.com`) while the RFC 5322 From
 * header carries the address people expect. Prefer the header; fall back to
 * the envelope when From is missing.
 */
export function visibleInboundFrom(
	envelopeFrom: string | null | undefined,
	headerFrom: string | null | undefined
): string {
	const header = parseEmailAddress(headerFrom ?? '');
	if (header.includes('@')) return header;
	return parseEmailAddress(envelopeFrom ?? '');
}

export function parseEmailAddresses(
	value: string | string[] | null | undefined
): string[] {
	if (!value) return [];

	const parts = Array.isArray(value) ? value : value.split(',');
	const addresses = new Set<string>();

	for (const part of parts) {
		const parsed = parseEmailAddress(part);
		if (parsed.includes('@')) {
			addresses.add(parsed);
		}
	}

	return [...addresses];
}

export function domainOf(address: string): string | null {
	const parsed = parseEmailAddress(address);
	const domain = parsed.split('@')[1];
	return domain || null;
}

/**
 * Every address an inbound Resend message could have been destined for.
 *
 * `received_for` is the address Resend actually accepted mail for (it survives
 * forwarding), so it is checked before the visible To/Cc headers.
 */
export function collectInboundRecipients(payload: {
	received_for?: string[] | null;
	to?: string[] | string | null;
	cc?: string[] | string | null;
	bcc?: string[] | string | null;
}): string[] {
	const recipients = new Set<string>();

	for (const source of [payload.received_for, payload.to, payload.cc, payload.bcc]) {
		for (const address of parseEmailAddresses(source ?? null)) {
			recipients.add(address);
		}
	}

	return [...recipients];
}

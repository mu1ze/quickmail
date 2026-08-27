/** Split a To/Cc/Bcc field into addresses the composer and provider accept. */
export function parseRecipientList(value: string | string[] | null | undefined): string[] {
	if (!value) return [];
	const parts = Array.isArray(value) ? value : value.split(',');
	const addresses: string[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		const address = part.trim();
		if (!address.includes('@')) continue;
		const key = address.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		addresses.push(address);
	}
	return addresses;
}

export type ReplyRecipientMode = 'reply' | 'replyAll';

/**
 * Recipients for a reply. Reply goes only to the other party; Reply all copies
 * everyone else who was on To/Cc, minus the mailbox we are sending from.
 */
export function buildReplyRecipients(input: {
	direction: 'inbound' | 'outbound';
	from: string;
	to: string;
	cc?: string | null;
	self?: string | null;
	mode: ReplyRecipientMode;
}): { to: string; cc: string } {
	const counterpart = input.direction === 'inbound' ? input.from : input.to;
	if (input.mode === 'reply') {
		return { to: parseRecipientList(counterpart).join(', '), cc: '' };
	}

	const to = parseRecipientList(counterpart);
	const extras = [
		...(input.direction === 'inbound' ? parseRecipientList(input.to) : []),
		...parseRecipientList(input.cc)
	];
	const skip = new Set([
		...to.map((address) => address.toLowerCase()),
		...(input.self ? [input.self.toLowerCase()] : [])
	]);
	const cc: string[] = [];
	for (const address of extras) {
		const key = address.toLowerCase();
		if (skip.has(key)) continue;
		skip.add(key);
		cc.push(address);
	}

	return { to: to.join(', '), cc: cc.join(', ') };
}

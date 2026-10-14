import type { MailboxView, ThreadParticipant, ThreadSummary } from './types';

/** Prefer a supplied display name; otherwise format a readable address label. */
export function displayAddress(address: string): string {
	const supplied = /^(.*?)\s*<[^>]+>\s*$/.exec(address);
	const name = supplied?.[1]?.trim().replace(/^"|"$/g, '');
	if (name) return name;
	const [local, domain] = address.split('@');
	if (!domain) return address;
	// Old mail may predate name storage. This is a readable address label, not
	// a recovered From name; the complete address remains on the row tooltip.
	const generic = /^(?:hello|hi|info|contact|mail|email|no[._-]?reply|notifications?|updates?|support|team|news|newsletter|billing|receipts?|alerts?|bounces?)(?:[+._-].*)?$/i;
	const words = generic.test(local) ? domain.split('.').slice(-2, -1)[0] : local.split('+')[0];
	return words.replace(/[._-]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) || address;
}

/** Name or address label shown on the first line of a mailbox row. */
export function participantName(participant: ThreadParticipant): string {
	return participant.name?.trim() || displayAddress(participant.address);
}

export function threadHeadline(thread: ThreadSummary, view: MailboxView): string {
	if (view === 'drafts' || (view === 'sent' && thread.participants.every((entry) => entry.self))) {
		const recipient = thread.participants.find((entry) => !entry.self) ?? thread.participants[0];
		return recipient?.address ? participantName(recipient) : view === 'drafts' ? 'No recipient' : 'Unknown';
	}

	const others = thread.participants.filter((entry) => !entry.self);
	const shown = others.length > 0 ? others : thread.participants;
	const names = shown.map(participantName).filter(Boolean);
	return names.join(', ') || 'Unknown';
}

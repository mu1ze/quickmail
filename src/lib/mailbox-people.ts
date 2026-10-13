import type { MailboxView, ThreadSummary } from './types';

/** Use a supplied display name, while keeping bare addresses intact. */
function displayAddress(address: string): string {
	const supplied = /^(.*?)\s*<[^>]+>\s*$/.exec(address);
	return supplied?.[1]?.trim().replace(/^"|"$/g, '') || address;
}

/** Address shown on the first line of a mailbox row. */
export function threadHeadline(thread: ThreadSummary, view: MailboxView): string {
	if (view === 'drafts' || (view === 'sent' && thread.participants.every((entry) => entry.self))) {
		const recipient = thread.participants.find((entry) => !entry.self) ?? thread.participants[0];
		return recipient?.address ? displayAddress(recipient.address) : view === 'drafts' ? 'No recipient' : 'Unknown';
	}

	const others = thread.participants.filter((entry) => !entry.self);
	const shown = others.length > 0 ? others : thread.participants;
	const emails = shown.map((entry) => displayAddress(entry.address)).filter(Boolean);
	return emails.join(', ') || 'Unknown';
}

import { fromSqliteDatetime } from '$lib/snooze';

type GroupedThread = { created_at: string; is_pinned: number | boolean };

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The section a conversation sits under in the list. The server sorts pinned
 * threads first and the rest newest first, so labels only ever change forward.
 */
export function mailboxGroupLabel(thread: GroupedThread, now = new Date()): string {
	if (thread.is_pinned) return 'Pinned';
	const date = fromSqliteDatetime(thread.created_at);
	if (Number.isNaN(date.getTime())) return 'Older';

	const today = startOfDay(now);
	const day = startOfDay(date);
	if (day >= today) return 'Today';
	if (day >= today - DAY_MS) return 'Yesterday';
	if (day > today - 7 * DAY_MS) return 'Previous 7 days';
	if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'Earlier this month';
	return date.toLocaleDateString([], {
		month: 'long',
		year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
	});
}

/** The heading to draw above each row, or null when it continues the group above. */
export function mailboxGroupHeadings(threads: GroupedThread[], now = new Date()): (string | null)[] {
	let previous: string | null = null;
	return threads.map((thread) => {
		const label = mailboxGroupLabel(thread, now);
		if (label === previous) return null;
		previous = label;
		return label;
	});
}

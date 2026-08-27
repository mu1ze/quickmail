export type MailboxLayout = 'cards' | 'list';

export const MAILBOX_LAYOUT_KEY = 'mail:layout';
export const MAILBOX_LAYOUT_EVENT = 'mail:layout';

function isLayout(value: string | null): value is MailboxLayout {
	return value === 'cards' || value === 'list';
}

export function readMailboxLayout(): MailboxLayout {
	if (typeof localStorage === 'undefined') return 'cards';
	const stored = localStorage.getItem(MAILBOX_LAYOUT_KEY);
	return isLayout(stored) ? stored : 'cards';
}

export function setMailboxLayout(layout: MailboxLayout): void {
	localStorage.setItem(MAILBOX_LAYOUT_KEY, layout);
	window.dispatchEvent(new CustomEvent(MAILBOX_LAYOUT_EVENT, { detail: layout }));
}

export function watchMailboxLayout(onChange: (layout: MailboxLayout) => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === MAILBOX_LAYOUT_KEY) onChange(readMailboxLayout());
	};
	const onLocal = (event: Event) => {
		const detail = (event as CustomEvent<MailboxLayout>).detail;
		onChange(detail ?? readMailboxLayout());
	};
	window.addEventListener('storage', onStorage);
	window.addEventListener(MAILBOX_LAYOUT_EVENT, onLocal);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(MAILBOX_LAYOUT_EVENT, onLocal);
	};
}

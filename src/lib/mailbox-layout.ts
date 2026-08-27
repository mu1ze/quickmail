export type MailboxLayout = 'cards' | 'list';

export const MAILBOX_LAYOUT_KEY = 'mail:layout';
export const MAILBOX_LAYOUT_EVENT = 'mail:layout';

export function parseMailboxLayout(value: string | null | undefined): MailboxLayout {
	return value === 'list' ? 'list' : 'cards';
}

export function readMailboxLayout(): MailboxLayout {
	if (typeof localStorage === 'undefined') return 'cards';
	return parseMailboxLayout(localStorage.getItem(MAILBOX_LAYOUT_KEY));
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

export type MailboxLayout = 'cards' | 'list';
export type MailboxDensity = 'comfortable' | 'compact';

export const MAILBOX_LAYOUT_KEY = 'mail:layout';
export const MAILBOX_LAYOUT_EVENT = 'mail:layout';
const DENSITY_KEY = 'mail:density';

export function parseMailboxLayout(value: string | null | undefined): MailboxLayout {
	return value === 'cards' ? 'cards' : 'list';
}

export function readMailboxLayout(): MailboxLayout {
	if (typeof localStorage === 'undefined') return 'list';
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

export function readMailboxDensity(): MailboxDensity {
	return typeof localStorage !== 'undefined' && localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

export function setMailboxDensity(density: MailboxDensity): void {
	localStorage.setItem(DENSITY_KEY, density);
	window.dispatchEvent(new Event(DENSITY_KEY));
}

export function watchMailboxDensity(onChange: (density: MailboxDensity) => void): () => void {
	const sync = () => onChange(readMailboxDensity());
	const storage = (event: StorageEvent) => { if (event.key === DENSITY_KEY) sync(); };
	window.addEventListener(DENSITY_KEY, sync);
	window.addEventListener('storage', storage);
	return () => { window.removeEventListener(DENSITY_KEY, sync); window.removeEventListener('storage', storage); };
}

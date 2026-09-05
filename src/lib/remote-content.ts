export const REMOTE_CONTENT_KEY = 'mail:remote-content';
export const REMOTE_CONTENT_EVENT = 'mail:remote-content';

/** In-memory copy so every open (and newly opened) message sees a toggle immediately. */
let cached: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();
let windowBound = false;

export function parseRemoteContentPreference(value: string | null | undefined): boolean {
	return value === '1' || value === 'true';
}

/**
 * When the Appearance toggle is on, every message loads remote content — mail
 * already in the inbox and mail that arrives later. A per-message opt-in only
 * applies while the toggle is off.
 */
export function shouldLoadRemoteContent(preference: boolean, messageOptIn = false): boolean {
	return preference || messageOptIn;
}

function remember(value: string | null | undefined): boolean {
	cached = parseRemoteContentPreference(value);
	return cached;
}

function notify(enabled: boolean): void {
	for (const listener of listeners) listener(enabled);
}

function onStorage(event: StorageEvent): void {
	if (event.key !== REMOTE_CONTENT_KEY) return;
	notify(remember(event.newValue));
}

function onLocal(event: Event): void {
	const detail = (event as CustomEvent<boolean>).detail;
	const enabled = typeof detail === 'boolean' ? detail : readRemoteContentPreference();
	notify(enabled);
}

function bindWindow(): void {
	if (windowBound || typeof window === 'undefined') return;
	windowBound = true;
	window.addEventListener('storage', onStorage);
	window.addEventListener(REMOTE_CONTENT_EVENT, onLocal);
}

/** Off by default so tracking pixels stay blocked until the user opts in. */
export function readRemoteContentPreference(): boolean {
	if (cached !== null) return cached;
	if (typeof localStorage === 'undefined') return false;
	return remember(localStorage.getItem(REMOTE_CONTENT_KEY));
}

export function setRemoteContentPreference(enabled: boolean): void {
	cached = enabled;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(REMOTE_CONTENT_KEY, enabled ? '1' : '0');
	}
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(REMOTE_CONTENT_EVENT, { detail: enabled }));
	}
}

export function watchRemoteContentPreference(onChange: (enabled: boolean) => void): () => void {
	listeners.add(onChange);
	bindWindow();
	return () => {
		listeners.delete(onChange);
	};
}

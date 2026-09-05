export const REMOTE_CONTENT_KEY = 'mail:remote-content';
export const REMOTE_CONTENT_EVENT = 'mail:remote-content';

/** In-memory copy so every open (and newly opened) message sees a toggle immediately. */
let cached: boolean | null = null;

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

/** Off by default so tracking pixels stay blocked until the user opts in. */
export function readRemoteContentPreference(): boolean {
	if (cached !== null) return cached;
	if (typeof localStorage === 'undefined') return false;
	cached = parseRemoteContentPreference(localStorage.getItem(REMOTE_CONTENT_KEY));
	return cached;
}

export function setRemoteContentPreference(enabled: boolean): void {
	cached = enabled;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(REMOTE_CONTENT_KEY, enabled ? '1' : '0');
	}
	window.dispatchEvent(new CustomEvent(REMOTE_CONTENT_EVENT, { detail: enabled }));
}

export function watchRemoteContentPreference(onChange: (enabled: boolean) => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === REMOTE_CONTENT_KEY) onChange(readRemoteContentPreference());
	};
	const onLocal = (event: Event) => {
		const detail = (event as CustomEvent<boolean>).detail;
		onChange(typeof detail === 'boolean' ? detail : readRemoteContentPreference());
	};
	window.addEventListener('storage', onStorage);
	window.addEventListener(REMOTE_CONTENT_EVENT, onLocal);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(REMOTE_CONTENT_EVENT, onLocal);
	};
}

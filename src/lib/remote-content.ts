export const REMOTE_CONTENT_KEY = 'mail:remote-content';
export const REMOTE_CONTENT_EVENT = 'mail:remote-content';

export function parseRemoteContentPreference(value: string | null | undefined): boolean {
	return value === '1' || value === 'true';
}

/** Off by default so tracking pixels stay blocked until the user opts in. */
export function readRemoteContentPreference(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return parseRemoteContentPreference(localStorage.getItem(REMOTE_CONTENT_KEY));
}

export function setRemoteContentPreference(enabled: boolean): void {
	localStorage.setItem(REMOTE_CONTENT_KEY, enabled ? '1' : '0');
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

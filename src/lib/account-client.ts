import { hasQueuedSend } from './pending-send';
import { requireOk } from './utils/request';

export type BrowserAccount = { id: string; name: string; email: string };
const CHANGE_KEY = 'mail:account-change';
const guards = new Set<() => Promise<void>>();

export function guardAccountChange(guard: () => Promise<void>): () => void {
	guards.add(guard);
	return () => { guards.delete(guard); };
}

export async function prepareAccountChange(): Promise<void> {
	if (hasQueuedSend()) throw new Error('Wait for your message to send, or undo it, before switching accounts.');
	for (const guard of guards) await guard();
}

export function announceAccountChange(userId: string | null): void {
	try { localStorage.setItem(CHANGE_KEY, JSON.stringify({ userId, nonce: crypto.randomUUID() })); }
	catch { /* Focus checks still protect tabs when storage is unavailable. */ }
}

async function closeAccountNotifications(): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	try {
		const registration = await navigator.serviceWorker.getRegistration();
		for (const notification of await registration?.getNotifications() ?? []) notification.close();
	} catch { /* Notification cleanup must not prevent account switching. */ }
}

export async function switchAccount(userId: string): Promise<void> {
	await prepareAccountChange();
	await requireOk(await fetch('/api/auth/accounts', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId })
	}));
	await finishAccountChange(userId);
}

export async function finishAccountChange(userId: string | null): Promise<void> {
	announceAccountChange(userId);
	await closeAccountNotifications();
	window.location.href = userId ? '/inbox' : '/login';
}

/** Bind requests to the identity that rendered this document, including stale tabs. */
export function watchAccountSession(userId: string | null, onChanged: () => void): () => void {
	const original = window.fetch;
	const guardedFetch: typeof fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
		const protectedRequest = url.origin === window.location.origin && (url.pathname.startsWith('/api/') || url.pathname.endsWith('/__data.json'));
		let options = init;
		if (userId && protectedRequest) {
			const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
			headers.set('X-QuickMail-Account', userId);
			// Keep non-enumerable metadata used by SvelteKit's own fetch wrapper.
			options = Object.create(Object.getPrototypeOf(init ?? {}), {
				...Object.getOwnPropertyDescriptors(init ?? {}),
				headers: { value: headers, writable: true, enumerable: true, configurable: true }
			});
		}
		const response = await original.call(window, input, options);
		if (protectedRequest && response.headers.get('X-QuickMail-Account-Changed') === '1') onChanged();
		return response;
	};
	window.fetch = guardedFetch;
	const onStorage = (event: StorageEvent) => {
		if (event.key !== CHANGE_KEY || !event.newValue) return;
		try { if (JSON.parse(event.newValue).userId !== userId) onChanged(); } catch { /* invalid event */ }
	};
	const onFocus = async () => {
		if (document.visibilityState === 'hidden') return;
		try {
			const response = await original.call(window, '/api/auth/me', { cache: 'no-store' });
			if (response.ok || response.status === 401) {
				const body = await response.json();
				if ((body.user?.id ?? null) !== userId) onChanged();
			}
		} catch { /* Offline tabs retain their current view. */ }
	};
	window.addEventListener('storage', onStorage);
	window.addEventListener('focus', onFocus);
	window.addEventListener('pageshow', onFocus);
	document.addEventListener('visibilitychange', onFocus);
	return () => {
		if (window.fetch === guardedFetch) window.fetch = original;
		window.removeEventListener('storage', onStorage);
		window.removeEventListener('focus', onFocus);
		window.removeEventListener('pageshow', onFocus);
		document.removeEventListener('visibilitychange', onFocus);
	};
}

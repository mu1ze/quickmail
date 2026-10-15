/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { version } from '$service-worker';

type PushPayload = {
	title?: unknown;
	body?: unknown;
	tag?: unknown;
	url?: unknown;
};

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const CACHE = `quickmail-${version}`;
/** Shown when a page can't be reached; kept small so installing stays cheap. */
const OFFLINE_PAGE = '/offline.html';
const PRECACHE = [OFFLINE_PAGE, '/icon-192.png'];

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE).catch(() => {});
			await worker.skipWaiting();
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && key.startsWith('quickmail-')) await caches.delete(key);
			}
			await worker.clients.claim();
		})()
	);
});

/**
 * Deliberately narrow caching:
 * - Fingerprinted app code under /_app/immutable/ is cache-first; its URL changes
 *   whenever it does, so it can never be stale. This is what makes launches fast.
 * - Page loads go to the network and fall back to the offline page only when it fails.
 * - Everything else (mail data, API calls, images) is left to the network untouched.
 */
worker.addEventListener('fetch', (event: FetchEvent) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== worker.location.origin) return;

	if (url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const hit = await cache.match(request);
				if (hit) return hit;
				const response = await fetch(request);
				if (response.ok) await cache.put(request, response.clone());
				return response;
			})()
		);
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(OFFLINE_PAGE)) ?? Response.error())
		);
	}
});

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readPushPayload(event: PushEvent): PushPayload {
	if (!event.data) return {};
	try {
		const value = event.data.json();
		return typeof value === 'object' && value !== null ? (value as PushPayload) : {};
	} catch {
		return {};
	}
}

async function currentAccountOwnsSubscription(): Promise<boolean> {
	try {
		const subscription = await worker.registration.pushManager.getSubscription();
		if (!subscription) return false;
		const endpoint = encodeURIComponent(subscription.endpoint);
		const response = await fetch(`/api/push/subscriptions?endpoint=${endpoint}`, {
			cache: 'no-store',
			credentials: 'same-origin'
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { registered?: unknown };
		return body.registered === true;
	} catch {
		// Prefer dropping an alert over exposing one account's mail on another
		// account's session when ownership cannot be verified.
		return false;
	}
}

worker.addEventListener('push', (event: PushEvent) => {
	const payload = readPushPayload(event);
	const url = stringValue(payload.url, '/inbox');

	event.waitUntil(
		(async () => {
			if (!(await currentAccountOwnsSubscription())) return;
			await worker.registration.showNotification(stringValue(payload.title, 'New message'), {
				body: stringValue(payload.body, 'You received a new email.'),
				icon: '/icon-192.png',
				badge: '/icon-192.png',
				tag: stringValue(payload.tag, 'quickmail-new-message'),
				data: { url }
			});
		})()
	);
});

worker.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const requested = stringValue((event.notification.data as { url?: unknown } | null)?.url, '/inbox');
	const requestedDestination = new URL(requested, worker.location.origin);
	const destination =
		requestedDestination.origin === worker.location.origin
			? requestedDestination
			: new URL('/inbox', worker.location.origin);

	event.waitUntil(
		(async () => {
			const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				const windowClient = client as WindowClient;
				if (new URL(windowClient.url).origin !== worker.location.origin) continue;
				try {
					await windowClient.navigate(destination.href);
					await windowClient.focus();
					return;
				} catch {
					await worker.clients.openWindow(destination.href);
					return;
				}
			}
			await worker.clients.openWindow(destination.href);
		})()
	);
});

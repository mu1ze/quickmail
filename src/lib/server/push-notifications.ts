import type { D1Database } from '@cloudflare/workers-types';
import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import {
	buildBrrrNewMailPayload,
	loadBrrrDestination,
	readPublicAppOrigin,
	resolveBrrrSound,
	sendBrrrNotification
} from './brrr';
import { getMailboxCounts } from './mail-store';
import { loadNotificationPrefs } from './notification-preferences';
import { decideNotification, type BulkSignals } from '$lib/notification-rules';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
export const MAX_SUBSCRIPTIONS_PER_USER = 10;
const PUSH_REQUEST_TIMEOUT_MS = 10_000;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export type PushSubscriptionInput = {
	endpoint: string;
	expirationTime: number | null;
	keys: {
		p256dh: string;
		auth: string;
	};
};

export type PushNotificationEnv = {
	DB: D1Database;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	/** Absolute origin for Brrr `open_url`. Omitted when unset (email() has no request URL). */
	PUBLIC_APP_URL?: string;
	waitUntil?: (promise: Promise<void>) => void;
	fetch?: typeof fetch;
};

type StoredPushSubscription = {
	endpoint: string;
	p256dh: string;
	auth: string;
	expiration_time: number | null;
};

export type NewMailNotificationInput = {
	emailId: string;
	userId: string;
	from: string;
	subject: string;
};

export type NewMailPushPayload = {
	title: string;
	body: string;
	/** One notification per conversation: a new message replaces the last. */
	tag: string;
	url: string;
	/** Lets the service worker archive or mark read straight from the notification. */
	emailId: string;
	/** Inbox unread count for the app-icon badge; null when it could not be read. */
	unread: number | null;
};

/** What the stored email adds beyond the inbound handler's input. */
export type NewMailDetails = {
	fromName: string | null;
	threadId: string;
	preview: string;
	signals: BulkSignals;
	unread: number | null;
};

type VapidConfiguration = {
	publicKey: string;
	privateKey: string;
	subject: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: unknown): Uint8Array | null {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAX_KEY_LENGTH ||
		!BASE64URL.test(value)
	) {
		return null;
	}

	const unpadded = value.replace(/=+$/, '');
	if (unpadded.length % 4 === 1) return null;
	const base64 = unpadded.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

	try {
		const binary = atob(padded);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

function validPublicKey(value: unknown): value is string {
	const decoded = decodeBase64Url(value);
	return decoded?.byteLength === 65 && decoded[0] === 0x04;
}

function validAuthSecret(value: unknown): value is string {
	return decodeBase64Url(value)?.byteLength === 16;
}

function validVapidKeyPair(publicKey: string, privateKey: string): boolean {
	const publicBytes = decodeBase64Url(publicKey);
	const privateBytes = decodeBase64Url(privateKey);
	if (publicBytes?.byteLength !== 65 || publicBytes[0] !== 0x04 || privateBytes?.byteLength !== 32) {
		return false;
	}

	try {
		const ecdh = createECDH('prime256v1');
		ecdh.setPrivateKey(privateBytes);
		const derivedPublicKey = ecdh.getPublicKey();
		return (
			derivedPublicKey.byteLength === publicBytes.byteLength &&
			derivedPublicKey.every((byte, index) => byte === publicBytes[index])
		);
	} catch {
		return false;
	}
}

function validEndpoint(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const endpoint = value.trim();
	if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) return false;

	try {
		const url = new URL(endpoint);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

/** Treat browser subscription JSON as untrusted input before storing it. */
export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
	if (!isRecord(value) || typeof value.endpoint !== 'string' || !isRecord(value.keys)) {
		return null;
	}

	if (!validEndpoint(value.endpoint)) return null;
	const endpoint = value.endpoint.trim();

	if (!validPublicKey(value.keys.p256dh) || !validAuthSecret(value.keys.auth)) return null;

	const expirationTime = value.expirationTime ?? null;
	if (
		expirationTime !== null &&
		(typeof expirationTime !== 'number' || !Number.isFinite(expirationTime) || expirationTime < 0)
	) {
		return null;
	}

	return {
		endpoint,
		expirationTime,
		keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }
	};
}

export function readVapidConfiguration(
	env: Pick<PushNotificationEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>
): VapidConfiguration | null {
	const publicKey = env.VAPID_PUBLIC_KEY?.trim();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	const subject = env.VAPID_SUBJECT?.trim();
	if (!publicKey || !privateKey || !subject || !validVapidKeyPair(publicKey, privateKey)) return null;
	try {
		const subjectUrl = new URL(subject);
		if (subjectUrl.protocol !== 'mailto:' && subjectUrl.protocol !== 'https:') return null;
		if (subjectUrl.protocol === 'mailto:' && !subjectUrl.pathname.trim()) return null;
	} catch {
		return null;
	}
	return { publicKey, privateKey, subject };
}

export async function savePushSubscription(
	db: D1Database,
	userId: string,
	subscription: PushSubscriptionInput,
	userAgent?: string | null
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO push_subscriptions (
				id, user_id, endpoint, p256dh, auth, expiration_time, user_agent
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(endpoint) DO UPDATE SET
				user_id = excluded.user_id,
				p256dh = excluded.p256dh,
				auth = excluded.auth,
				expiration_time = excluded.expiration_time,
				user_agent = excluded.user_agent,
				updated_at = datetime('now')`
		)
		.bind(
			crypto.randomUUID(),
			userId,
			subscription.endpoint,
			subscription.keys.p256dh,
			subscription.keys.auth,
			subscription.expirationTime,
			userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null
		)
		.run();

	await capUserSubscriptions(db, userId, subscription.endpoint);
}

async function capUserSubscriptions(
	db: D1Database,
	userId: string,
	keepEndpoint: string
): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT id FROM push_subscriptions
			 WHERE user_id = ?
			 ORDER BY (endpoint = ?) DESC, updated_at DESC, rowid DESC`
		)
		.bind(userId, keepEndpoint)
		.all<{ id: string }>();

	const extraIds = results.slice(MAX_SUBSCRIPTIONS_PER_USER).map((row) => row.id);
	if (extraIds.length === 0) return;

	await db.batch(
		extraIds.map((id) => db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id))
	);
}

export async function hasPushSubscription(
	db: D1Database,
	userId: string,
	endpoint: string
): Promise<boolean> {
	if (!validEndpoint(endpoint)) return false;
	const row = await db
		.prepare('SELECT 1 AS registered FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
		.bind(userId, endpoint.trim())
		.first<{ registered: number }>();
	return row?.registered === 1;
}

export async function removePushSubscription(
	db: D1Database,
	userId: string,
	endpoint: string
): Promise<boolean> {
	const result = await db
		.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
		.bind(userId, endpoint)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

async function listPushSubscriptions(
	db: D1Database,
	userId: string
): Promise<StoredPushSubscription[]> {
	const { results } = await db
		.prepare(
			`SELECT endpoint, p256dh, auth, expiration_time
			 FROM push_subscriptions WHERE user_id = ?
			 ORDER BY updated_at DESC, rowid DESC
			 LIMIT ?`
		)
		.bind(userId, MAX_SUBSCRIPTIONS_PER_USER)
		.all<StoredPushSubscription>();
	return results;
}

async function removeDeadSubscriptions(db: D1Database, endpoints: string[]): Promise<void> {
	if (endpoints.length === 0) return;
	await db.batch(
		endpoints.map((endpoint) =>
			db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint)
		)
	);
}

function truncate(value: string, max: number): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

/**
 * Sender as the title, subject as the text, grouped per conversation. The
 * message's own words are only included when the user turned previews on,
 * because notifications can appear on a locked screen.
 */
export function buildNewMailPayload(
	input: NewMailNotificationInput,
	details: Partial<NewMailDetails> = {},
	options: { preview?: boolean } = {}
): NewMailPushPayload {
	const sender = truncate(details.fromName || input.from || 'Unknown sender', 80) || 'Unknown sender';
	const subject = truncate(input.subject || '(no subject)', 120) || '(no subject)';
	const preview = options.preview && details.preview ? truncate(details.preview, 140) : '';
	return {
		title: sender,
		body: preview ? `${subject}\n${preview}` : subject,
		tag: `quickmail-thread-${details.threadId ?? input.emailId}`,
		url: `/mail/${encodeURIComponent(input.emailId)}`,
		emailId: input.emailId,
		unread: details.unread ?? null
	};
}

async function loadNewMailDetails(db: D1Database, input: NewMailNotificationInput): Promise<NewMailDetails> {
	let row: { from_name: string | null; thread_id: string; preview: string | null; metadata_json: string | null } | null = null;
	try {
		row = await db
			.prepare(
				`SELECT e.from_name, COALESCE(e.thread_id, e.id) AS thread_id, e.preview, m.metadata_json
				 FROM emails e LEFT JOIN email_analysis_metadata m ON m.email_id = e.id AND m.user_id = e.user_id
				 WHERE e.id = ? AND e.user_id = ?`
			)
			.bind(input.emailId, input.userId)
			.first();
	} catch {
		row = null;
	}
	let signals: BulkSignals = {};
	try {
		signals = JSON.parse(row?.metadata_json ?? '{}') as BulkSignals;
	} catch {
		/* older mail without metadata */
	}
	let unread: number | null = null;
	try {
		unread = (await getMailboxCounts(db, input.userId, null)).inbox_unread ?? null;
	} catch {
		unread = null;
	}
	return { fromName: row?.from_name ?? null, threadId: row?.thread_id ?? input.emailId, preview: row?.preview ?? '', signals, unread };
}

export function pushErrorStatus(error: unknown): number | null {
	if (!isRecord(error) || typeof error.statusCode !== 'number') return null;
	return error.statusCode;
}

/**
 * Notify the recipient's browsers (Web Push) and Brrr destination. Failures
 * never undo a successfully stored email; expired push endpoints are removed.
 */
export async function notifyNewMail(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	try {
		await deliverNewMailNotification(env, input);
	} catch (error) {
		console.error(
			'Failed to deliver new-mail notifications',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
}

/** Schedule best-effort delivery without holding up inbound-provider acknowledgement. */
export async function scheduleNewMailNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	const task = notifyNewMail(env, input);
	if (env.waitUntil) {
		env.waitUntil(task);
		return;
	}
	await task;
}

async function deliverNewMailNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	const [prefs, details] = await Promise.all([loadNotificationPrefs(env.DB, input.userId), loadNewMailDetails(env.DB, input)]);
	// The user's rules apply to every channel: browser push and Brrr alike.
	if (!decideNotification(prefs, { address: input.from, signals: details.signals }).notify) return;
	await Promise.all([
		deliverWebPushNotification(env, input, details, prefs.preview),
		deliverBrrrNotification(env, input)
	]);
}

async function deliverWebPushNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput,
	details: NewMailDetails,
	preview: boolean
): Promise<void> {
	const vapid = readVapidConfiguration(env);
	if (!vapid) return;

	const subscriptions = await listPushSubscriptions(env.DB, input.userId);
	if (subscriptions.length === 0) return;

	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
	const payload = JSON.stringify(buildNewMailPayload(input, details, { preview }));
	const deadEndpoints: string[] = [];

	await Promise.all(
		subscriptions.map(async (subscription) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: subscription.endpoint,
						expirationTime: subscription.expiration_time,
						keys: { p256dh: subscription.p256dh, auth: subscription.auth }
					},
					payload,
					{ TTL: 300, urgency: 'high', timeout: PUSH_REQUEST_TIMEOUT_MS }
				);
			} catch (error) {
				const status = pushErrorStatus(error);
				if (status === 404 || status === 410) {
					deadEndpoints.push(subscription.endpoint);
				} else {
					console.error(
						'Failed to send new-mail push notification',
						status ?? (error instanceof Error ? error.message : 'Unknown error')
					);
				}
			}
		})
	);

	await removeDeadSubscriptions(env.DB, deadEndpoints);
}

async function deliverBrrrNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	const destination = await loadBrrrDestination(env.DB, input.userId);
	if (!destination) return;

	const payload = buildBrrrNewMailPayload({
		subject: input.subject,
		from: input.from,
		emailId: input.emailId,
		origin: readPublicAppOrigin(env.PUBLIC_APP_URL),
		sound: resolveBrrrSound(input.from, destination.defaultSound, destination.senderSounds)
	});

	try {
		const result = await sendBrrrNotification(
			destination.webhookKey,
			payload,
			env.fetch ?? globalThis.fetch
		);
		if (!result.ok) {
			console.error('Failed to send Brrr notification', result.status);
		}
	} catch (error) {
		console.error(
			'Failed to send Brrr notification',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
}

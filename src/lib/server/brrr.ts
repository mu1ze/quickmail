import type { D1Database } from '@cloudflare/workers-types';
import { parseEmailAddress } from './email-address';

export const BRRR_SEND_URL = 'https://api.brrr.now/v1/send';
export const BRRR_HOST = 'api.brrr.now';
export const MAX_BRRR_WEBHOOK_INPUT = 256;
export const MAX_SENDER_SOUND_RULES = 20;
export const BRRR_REQUEST_TIMEOUT_MS = 10_000;

/** Sounds documented at https://brrr.now/docs/ (iPhone / iPad). */
export const BRRR_SOUNDS = [
	'default',
	'system',
	'brrr',
	'bell_ringing',
	'bubble_ding',
	'bubbly_success_ding',
	'cat_meow',
	'calm1',
	'calm2',
	'cha_ching',
	'dog_barking',
	'door_bell',
	'duck_quack',
	'emergency',
	'short_triple_blink',
	'upbeat_bells',
	'warm_soft_error'
] as const;

export type BrrrSound = (typeof BRRR_SOUNDS)[number];

const SOUND_LABELS: Record<BrrrSound, string> = {
	default: 'Default',
	system: 'System',
	brrr: 'Brrr',
	bell_ringing: 'Bell ringing',
	bubble_ding: 'Bubble ding',
	bubbly_success_ding: 'Bubbly success ding',
	cat_meow: 'Cat meow',
	calm1: 'Calm 1',
	calm2: 'Calm 2',
	cha_ching: 'Cha-ching',
	dog_barking: 'Dog barking',
	door_bell: 'Doorbell',
	duck_quack: 'Duck quack',
	emergency: 'Emergency',
	short_triple_blink: 'Short triple blink',
	upbeat_bells: 'Upbeat bells',
	warm_soft_error: 'Warm soft error'
};

export const BRRR_SOUND_OPTIONS = BRRR_SOUNDS.map((value) => ({
	value,
	label: SOUND_LABELS[value]
}));

const SECRET_RE = /^br_[a-z0-9_]+$/i;

export type SenderSoundRule = {
	sender: string;
	sound: BrrrSound;
};

export type BrrrSettingsView = {
	configured: boolean;
	preview: string | null;
	defaultSound: BrrrSound;
	senderSounds: SenderSoundRule[];
};

export type BrrrDestination = {
	webhookKey: string;
	defaultSound: BrrrSound;
	senderSounds: SenderSoundRule[];
};

export type BrrrPayload = {
	title: string;
	message: string;
	thread_id?: string;
	open_url?: string;
	sound?: BrrrSound;
};

type StoredBrrrRow = {
	webhook_key: string;
	default_sound: string;
	sender_sounds: string;
};

function isBrrrSound(value: unknown): value is BrrrSound {
	return typeof value === 'string' && (BRRR_SOUNDS as readonly string[]).includes(value);
}

export function parseBrrrSound(value: unknown, fallback: BrrrSound = 'default'): BrrrSound {
	return isBrrrSound(value) ? value : fallback;
}

/**
 * Accept either a full Brrr webhook URL or the secret alone (`br_usr_…`).
 * Host must be api.brrr.now; path must be /v1/<secret>.
 */
export function parseBrrrWebhook(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (!trimmed || trimmed.length > MAX_BRRR_WEBHOOK_INPUT) return null;

	if (SECRET_RE.test(trimmed)) return trimmed;

	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:') return null;
		if (url.hostname !== BRRR_HOST) return null;
		if (url.username || url.password) return null;

		const parts = url.pathname.split('/').filter(Boolean);
		if (parts.length !== 2 || parts[0] !== 'v1') return null;
		if (!SECRET_RE.test(parts[1])) return null;
		return parts[1];
	} catch {
		return null;
	}
}

/** Masked preview only — never return the full secret to the client again. */
export function maskBrrrSecret(secret: string): string {
	const last = secret.slice(-4);
	const prefixMatch = secret.match(/^(br_[a-z0-9]+_)/i);
	const prefix = prefixMatch?.[1] ?? 'br_';
	return `${prefix}…${last}`;
}

export function parseSenderSoundRules(value: unknown): SenderSoundRule[] | null {
	if (value == null) return [];
	if (!Array.isArray(value)) return null;
	if (value.length > MAX_SENDER_SOUND_RULES) return null;

	const rules: SenderSoundRule[] = [];
	const seen = new Set<string>();

	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
		const record = entry as Record<string, unknown>;
		if (typeof record.sender !== 'string' || !isBrrrSound(record.sound)) return null;

		const sender = parseEmailAddress(record.sender);
		if (!sender.includes('@') || sender.length > 320) return null;
		if (seen.has(sender)) continue;
		seen.add(sender);
		rules.push({ sender, sound: record.sound });
	}

	return rules;
}

function parseStoredSenderSounds(raw: string): SenderSoundRule[] {
	try {
		return parseSenderSoundRules(JSON.parse(raw)) ?? [];
	} catch {
		return [];
	}
}

export function resolveBrrrSound(
	from: string,
	defaultSound: BrrrSound,
	rules: SenderSoundRule[]
): BrrrSound {
	const fromAddress = parseEmailAddress(from);
	for (const rule of rules) {
		if (rule.sender === fromAddress) return rule.sound;
	}
	return defaultSound;
}

export function readPublicAppOrigin(value: string | undefined | null): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		if (url.username || url.password) return null;
		return url.origin;
	} catch {
		return null;
	}
}

function truncate(value: string, max: number): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function buildBrrrNewMailPayload(input: {
	subject: string;
	from: string;
	emailId: string;
	origin: string | null;
	sound: BrrrSound;
}): BrrrPayload {
	const payload: BrrrPayload = {
		title: truncate(input.subject || '(no subject)', 120) || '(no subject)',
		message: `From ${truncate(input.from || 'Unknown sender', 160) || 'Unknown sender'}`,
		thread_id: 'quickmail-inbox',
		sound: input.sound
	};
	if (input.origin) {
		payload.open_url = `${input.origin}/mail/${encodeURIComponent(input.emailId)}`;
	}
	return payload;
}

export function buildBrrrTestPayload(sound: BrrrSound): BrrrPayload {
	return {
		title: 'QuickMail',
		message: 'Test notification from QuickMail',
		thread_id: 'quickmail-inbox',
		sound
	};
}

function viewFromDestination(destination: BrrrDestination | null): BrrrSettingsView {
	if (!destination) {
		return {
			configured: false,
			preview: null,
			defaultSound: 'default',
			senderSounds: []
		};
	}

	return {
		configured: true,
		preview: maskBrrrSecret(destination.webhookKey),
		defaultSound: destination.defaultSound,
		senderSounds: destination.senderSounds
	};
}

function destinationFromRow(row: StoredBrrrRow): BrrrDestination {
	return {
		webhookKey: row.webhook_key,
		defaultSound: parseBrrrSound(row.default_sound),
		senderSounds: parseStoredSenderSounds(row.sender_sounds)
	};
}

export async function loadBrrrDestination(
	db: D1Database,
	userId: string
): Promise<BrrrDestination | null> {
	const row = await db
		.prepare(
			`SELECT webhook_key, default_sound, sender_sounds
			 FROM brrr_destinations WHERE user_id = ?`
		)
		.bind(userId)
		.first<StoredBrrrRow>();
	return row ? destinationFromRow(row) : null;
}

export async function loadBrrrSettings(
	db: D1Database,
	userId: string
): Promise<BrrrSettingsView> {
	return viewFromDestination(await loadBrrrDestination(db, userId));
}

export type SaveBrrrInput = {
	webhook?: unknown;
	defaultSound?: unknown;
	senderSounds?: unknown;
};

export async function saveBrrrSettings(
	db: D1Database,
	userId: string,
	input: SaveBrrrInput
): Promise<BrrrSettingsView> {
	const existing = await loadBrrrDestination(db, userId);
	const webhookProvided = typeof input.webhook === 'string' && input.webhook.trim().length > 0;
	const webhookKey = webhookProvided
		? parseBrrrWebhook(input.webhook)
		: (existing?.webhookKey ?? null);

	if (!webhookKey) {
		throw new BrrrSettingsError(
			existing
				? 'Paste a valid Brrr webhook URL or secret to replace the saved destination.'
				: 'Paste a Brrr webhook URL or secret from the Brrr app.'
		);
	}

	const defaultSound = parseBrrrSound(input.defaultSound, existing?.defaultSound ?? 'default');
	if (input.defaultSound != null && !isBrrrSound(input.defaultSound)) {
		throw new BrrrSettingsError('Choose a supported Brrr sound.');
	}

	const senderSounds =
		input.senderSounds === undefined
			? (existing?.senderSounds ?? [])
			: parseSenderSoundRules(input.senderSounds);
	if (!senderSounds) {
		throw new BrrrSettingsError(
			`Sender sounds must be up to ${MAX_SENDER_SOUND_RULES} email addresses with a supported sound.`
		);
	}

	await db
		.prepare(
			`INSERT INTO brrr_destinations (
				user_id, webhook_key, default_sound, sender_sounds
			) VALUES (?, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				webhook_key = excluded.webhook_key,
				default_sound = excluded.default_sound,
				sender_sounds = excluded.sender_sounds,
				updated_at = datetime('now')`
		)
		.bind(userId, webhookKey, defaultSound, JSON.stringify(senderSounds))
		.run();

	return viewFromDestination({ webhookKey, defaultSound, senderSounds });
}

export async function deleteBrrrSettings(db: D1Database, userId: string): Promise<void> {
	await db.prepare('DELETE FROM brrr_destinations WHERE user_id = ?').bind(userId).run();
}

export async function sendBrrrNotification(
	webhookKey: string,
	payload: BrrrPayload,
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: number }> {
	const response = await fetchImpl(BRRR_SEND_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${webhookKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(BRRR_REQUEST_TIMEOUT_MS)
	});
	return { ok: response.ok, status: response.status };
}

export class BrrrSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrrrSettingsError';
	}
}

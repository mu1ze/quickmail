import { isValidTimeZone, zonedNow } from './signature-live';

/**
 * Which new mail is worth interrupting someone for. Decided when mail arrives,
 * from what is known then: the sender and the bulk-mail headers. (Email
 * analysis runs later, so it can't gate a notification without delaying it.)
 */

export type NotificationMode = 'all' | 'people' | 'vip';

export type NotificationPrefs = {
	mode: NotificationMode;
	/** Addresses ("ada@example.com") or whole domains ("@example.com"). VIPs always get through. */
	vips: string[];
	/** Include the first line of the message. Off by default: notifications can show on a locked screen. */
	preview: boolean;
	/** Put sign-in codes in the notification, and let that mail through quiet hours and filters. */
	codes: boolean;
	quiet: { enabled: boolean; start: number; end: number; tz: string };
};

export const MAX_VIPS = 50;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
	mode: 'all',
	vips: [],
	preview: false,
	codes: true,
	quiet: { enabled: false, start: 22 * 60, end: 7 * 60, tz: 'UTC' }
};

const VIP_RE = /^(?:[^\s@]+@)?@?[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Lower-cased, de-duplicated, and limited to plausible addresses or domains. */
export function cleanVipList(input: unknown): string[] {
	const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,;]+/) : [];
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string') continue;
		let value = item.trim().toLowerCase().replace(/^mailto:/, '');
		if (!value || value.length > 254 || !VIP_RE.test(value)) continue;
		// A bare domain means everyone at it.
		if (!value.includes('@')) value = `@${value}`;
		if (!out.includes(value)) out.push(value);
		if (out.length >= MAX_VIPS) break;
	}
	return out;
}

function minutes(value: unknown, fallback: number): number {
	const n = Math.round(Number(value));
	return Number.isFinite(n) && n >= 0 && n <= 1440 ? n - (n % 15) : fallback;
}

export function sanitizeNotificationPrefs(input: unknown): NotificationPrefs {
	const raw = (input && typeof input === 'object' ? input : {}) as Partial<NotificationPrefs>;
	const base = DEFAULT_NOTIFICATION_PREFS;
	const quiet = (raw.quiet && typeof raw.quiet === 'object' ? raw.quiet : {}) as Partial<NotificationPrefs['quiet']>;
	return {
		mode: raw.mode === 'people' || raw.mode === 'vip' ? raw.mode : 'all',
		vips: cleanVipList(raw.vips),
		preview: raw.preview === true,
		codes: raw.codes !== false,
		quiet: {
			enabled: quiet.enabled === true,
			start: minutes(quiet.start, base.quiet.start),
			end: minutes(quiet.end, base.quiet.end),
			tz: typeof quiet.tz === 'string' && isValidTimeZone(quiet.tz) ? quiet.tz : base.quiet.tz
		}
	};
}

export function isVipSender(vips: string[], address: string): boolean {
	const email = address.trim().toLowerCase();
	const at = email.lastIndexOf('@');
	if (at < 0) return false;
	const domain = email.slice(at + 1);
	return vips.some((entry) => {
		if (!entry.startsWith('@')) return entry === email;
		const vipDomain = entry.slice(1);
		return domain === vipDomain || domain.endsWith(`.${vipDomain}`);
	});
}

export type BulkSignals = {
	hasListUnsubscribe?: boolean;
	listId?: string;
	autoSubmitted?: string;
	precedence?: string;
};

const ROBOT_SENDER = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|bounces?|news(?:letter)?|marketing|updates?|info)(?:[+._-].*)?@/i;

/** Newsletters, mailing lists, receipts from robots: mail with no person waiting on you. */
export function isAutomatedMail(signals: BulkSignals, address: string): boolean {
	if (signals.hasListUnsubscribe || signals.listId) return true;
	const auto = signals.autoSubmitted?.trim().toLowerCase();
	if (auto && auto !== 'no') return true;
	const precedence = signals.precedence?.trim().toLowerCase();
	if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true;
	return ROBOT_SENDER.test(address.trim());
}

export function inQuietHours(quiet: NotificationPrefs['quiet'], now: Date): boolean {
	if (!quiet.enabled || quiet.start === quiet.end) return false;
	const { minutes: m } = zonedNow(now, quiet.tz);
	return quiet.start < quiet.end ? m >= quiet.start && m < quiet.end : m >= quiet.start || m < quiet.end;
}

export type NotificationDecision = { notify: boolean; vip: boolean };

export function decideNotification(
	prefs: NotificationPrefs,
	mail: { address: string; signals: BulkSignals; hasCode?: boolean },
	now = new Date()
): NotificationDecision {
	const vip = isVipSender(prefs.vips, mail.address);
	if (vip) return { notify: true, vip };
	// You asked for this code moments ago; it can't wait for morning.
	if (mail.hasCode && prefs.codes) return { notify: true, vip };
	if (inQuietHours(prefs.quiet, now)) return { notify: false, vip };
	if (prefs.mode === 'vip') return { notify: false, vip };
	if (prefs.mode === 'people' && isAutomatedMail(mail.signals, mail.address)) return { notify: false, vip };
	return { notify: true, vip };
}

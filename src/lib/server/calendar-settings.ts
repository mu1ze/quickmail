import type { D1Database } from '@cloudflare/workers-types';
import { isValidTimeZone } from '$lib/calendar/time';
import { TIMED_REMINDERS, type CalendarSettings } from '$lib/calendar/types';

type SettingsRow = {
	time_zone: string;
	default_reminder: number | null;
	agenda_email: number;
	agenda_hour: number;
	feed_token: string | null;
};

export type StoredCalendarSettings = Omit<CalendarSettings, 'feedUrl'> & { feedToken: string | null };

const DEFAULTS: StoredCalendarSettings = { timeZone: 'UTC', defaultReminder: 10, agendaEmail: false, agendaHour: 7, feedToken: null };

export async function getCalendarSettings(db: D1Database, userId: string): Promise<StoredCalendarSettings> {
	const row = await db
		.prepare('SELECT time_zone, default_reminder, agenda_email, agenda_hour, feed_token FROM calendar_settings WHERE user_id = ?')
		.bind(userId)
		.first<SettingsRow>();
	if (!row) return { ...DEFAULTS };
	return {
		timeZone: isValidTimeZone(row.time_zone) ? row.time_zone : 'UTC',
		defaultReminder: row.default_reminder,
		agendaEmail: Boolean(row.agenda_email),
		agendaHour: row.agenda_hour,
		feedToken: row.feed_token
	};
}

export function feedUrl(origin: string, token: string | null): string | null {
	return token ? `${origin}/ical/${token}.ics` : null;
}

export function publicSettings(settings: StoredCalendarSettings, origin: string): CalendarSettings {
	const { feedToken, ...rest } = settings;
	return { ...rest, feedUrl: feedUrl(origin, feedToken) };
}

/** The reminders and agenda run on the server, so it needs the user's zone. */
export async function rememberTimeZone(db: D1Database, userId: string, timeZone: string): Promise<void> {
	if (!isValidTimeZone(timeZone)) return;
	await db
		.prepare(
			`INSERT INTO calendar_settings(user_id, time_zone) VALUES (?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET time_zone = excluded.time_zone, updated_at = datetime('now')
			 WHERE calendar_settings.time_zone != excluded.time_zone`
		)
		.bind(userId, timeZone)
		.run();
}

export function validateSettings(body: unknown): { ok: true; value: Partial<Pick<StoredCalendarSettings, 'defaultReminder' | 'agendaEmail' | 'agendaHour'>> } | { ok: false; error: string } {
	if (!body || typeof body !== 'object') return { ok: false, error: 'Expected settings.' };
	const input = body as Record<string, unknown>;
	const value: Partial<Pick<StoredCalendarSettings, 'defaultReminder' | 'agendaEmail' | 'agendaHour'>> = {};
	if ('defaultReminder' in input) {
		if (input.defaultReminder !== null && !TIMED_REMINDERS.includes(input.defaultReminder as number)) return { ok: false, error: 'Pick one of the reminder choices.' };
		value.defaultReminder = input.defaultReminder as number | null;
	}
	if ('agendaEmail' in input) {
		if (typeof input.agendaEmail !== 'boolean') return { ok: false, error: 'Turn the daily agenda on or off.' };
		value.agendaEmail = input.agendaEmail;
	}
	if ('agendaHour' in input) {
		if (!Number.isInteger(input.agendaHour) || (input.agendaHour as number) < 0 || (input.agendaHour as number) > 23) return { ok: false, error: 'Pick an hour for the agenda.' };
		value.agendaHour = input.agendaHour as number;
	}
	return { ok: true, value };
}

export async function saveCalendarSettings(db: D1Database, userId: string, changes: Partial<Pick<StoredCalendarSettings, 'defaultReminder' | 'agendaEmail' | 'agendaHour'>>): Promise<void> {
	const current = await getCalendarSettings(db, userId);
	const next = { ...current, ...changes };
	await db
		.prepare(
			`INSERT INTO calendar_settings(user_id, time_zone, default_reminder, agenda_email, agenda_hour) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET default_reminder = excluded.default_reminder, agenda_email = excluded.agenda_email,
			   agenda_hour = excluded.agenda_hour, updated_at = datetime('now')`
		)
		.bind(userId, next.timeZone, next.defaultReminder, next.agendaEmail ? 1 : 0, next.agendaHour)
		.run();
}

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Creates (or replaces) the private subscribe link; null turns it off. */
export async function setFeedToken(db: D1Database, userId: string, enabled: boolean): Promise<string | null> {
	const token = enabled ? randomToken() : null;
	await db
		.prepare(
			`INSERT INTO calendar_settings(user_id, feed_token) VALUES (?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET feed_token = excluded.feed_token, updated_at = datetime('now')`
		)
		.bind(userId, token)
		.run();
	return token;
}

export async function userForFeedToken(db: D1Database, token: string): Promise<string | null> {
	if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
	const row = await db.prepare('SELECT user_id FROM calendar_settings WHERE feed_token = ?').bind(token).first<{ user_id: string }>();
	return row?.user_id ?? null;
}

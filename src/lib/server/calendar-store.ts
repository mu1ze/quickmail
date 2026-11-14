import type { D1Database } from '@cloudflare/workers-types';
import {
	expandSeries,
	formatRecurrence,
	lastOccurrence,
	parseRecurrence,
	retargetRecurrence,
	type Recurrence,
	type SeriesSpec
} from '$lib/calendar/recurrence';
import {
	addDays,
	diffDays,
	isDateKey,
	isValidTimeZone,
	startOfDayUtc,
	zonedParts,
	zonedToUtc,
	type DateKey
} from '$lib/calendar/time';
import {
	CALENDAR_COLORS,
	MAX_GUESTS,
	MAX_REMINDERS,
	type Attendee,
	type AttendeeStatus,
	type CalendarInfo,
	type CalendarOccurrence,
	type CalendarSettings,
	type EditScope,
	type EventInput,
	type Organizer
} from '$lib/calendar/types';

export const MAX_CALENDARS = 30;
export const MAX_EVENTS = 20_000;
const MAX_TITLE = 300;
const MAX_LOCATION = 500;
const MAX_DESCRIPTION = 10_000;
const MAX_EVENT_DAYS = 1000;
const MAX_RANGE_DAYS = 400;
const MAX_OCCURRENCES = 3000;

type CalendarRow = { id: string; name: string; color: string; is_default: number; source_url: string | null; synced_at: string | null; sync_error: string | null };

export type EventRow = {
	id: string;
	user_id: string;
	calendar_id: string;
	title: string;
	description: string;
	location: string;
	all_day: number;
	start_at: string;
	end_at: string;
	time_zone: string;
	rrule: string | null;
	exdates: string;
	recur_until: string | null;
	ical_uid: string | null;
	recurrence_id: string | null;
	sequence: number;
	organizer: string | null;
	attendees: string;
	my_email: string | null;
	my_status: string | null;
	reminders: string;
};

export const EVENT_COLUMNS =
	'id, user_id, calendar_id, title, description, location, all_day, start_at, end_at, time_zone, rrule, exdates, recur_until, ical_uid, recurrence_id, sequence, organizer, attendees, my_email, my_status, reminders';

function toCalendar(row: CalendarRow): CalendarInfo {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		is_default: Boolean(row.is_default),
		source_url: row.source_url ?? null,
		synced_at: row.synced_at ?? null,
		sync_error: row.sync_error ?? null
	};
}

const CALENDAR_COLUMNS = 'id, name, color, is_default, source_url, synced_at, sync_error';

export async function listCalendars(db: D1Database, userId: string): Promise<CalendarInfo[]> {
	const select = () =>
		db
			.prepare(`SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE user_id = ? ORDER BY is_default DESC, created_at, name`)
			.bind(userId)
			.all<CalendarRow>();
	let { results } = await select();
	if (!results.length) {
		// First visit: give the user a calendar to put events in.
		await db
			.prepare(
				`INSERT INTO calendars(id, user_id, name, color, is_default)
				 SELECT ?, ?, 'Personal', ?, 1 WHERE NOT EXISTS (SELECT 1 FROM calendars WHERE user_id = ?)`
			)
			.bind(crypto.randomUUID(), userId, CALENDAR_COLORS[0], userId)
			.run();
		({ results } = await select());
	}
	return results.map(toCalendar);
}

export function cleanCalendarName(value: unknown): string | null {
	const name = typeof value === 'string' ? value.trim() : '';
	return name && name.length <= 60 && !/[\u0000-\u001f]/.test(name) ? name : null;
}

export function cleanCalendarColor(value: unknown): string | null {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export async function createCalendar(db: D1Database, userId: string, name: string, color: string, sourceUrl: string | null = null): Promise<CalendarInfo | null> {
	const id = crypto.randomUUID();
	const result = await db
		.prepare(
			`INSERT INTO calendars(id, user_id, name, color, is_default, source_url)
			 SELECT ?, ?, ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM calendars WHERE user_id = ?) < ?`
		)
		.bind(id, userId, name, color, sourceUrl, userId, MAX_CALENDARS)
		.run();
	return result.meta.changes ? { id, name, color, is_default: false, source_url: sourceUrl, synced_at: null, sync_error: null } : null;
}

export async function getCalendar(db: D1Database, userId: string, id: string): Promise<CalendarInfo | null> {
	const row = await db.prepare(`SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE id = ? AND user_id = ?`).bind(id, userId).first<CalendarRow>();
	return row ? toCalendar(row) : null;
}

/** Calendars the user can add or change events in (subscriptions are read-only). */
export function writableCalendarIds(calendars: CalendarInfo[]): string[] {
	return calendars.filter((calendar) => !calendar.source_url).map((calendar) => calendar.id);
}

export async function updateCalendar(db: D1Database, userId: string, id: string, changes: { name?: string; color?: string }): Promise<boolean> {
	const result = await db
		.prepare('UPDATE calendars SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND user_id = ?')
		.bind(changes.name ?? null, changes.color ?? null, id, userId)
		.run();
	return Boolean(result.meta.changes);
}

/** Deletes a calendar and its events. The default calendar stays. */
export async function deleteCalendar(db: D1Database, userId: string, id: string): Promise<'deleted' | 'default' | 'missing'> {
	const row = await db.prepare('SELECT is_default FROM calendars WHERE id = ? AND user_id = ?').bind(id, userId).first<{ is_default: number }>();
	if (!row) return 'missing';
	if (row.is_default) return 'default';
	await db.prepare('DELETE FROM calendars WHERE id = ? AND user_id = ? AND is_default = 0').bind(id, userId).run();
	return 'deleted';
}

// ---------------------------------------------------------------------------
// Input validation

function cleanText(value: unknown, max: number): string | null {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') return null;
	const text = value.replace(/\r\n/g, '\n').trim();
	return text.length <= max ? text : null;
}

function cleanInstant(value: unknown): number | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return null;
	const year = new Date(ms).getUTCFullYear();
	return year >= 1900 && year <= 2200 ? ms : null;
}

export type ValidEvent = EventInput & { rule: Recurrence | null; attendees: { email: string; name: string | null }[]; reminders: number[] };

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function cleanEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	return email.length <= 254 && EMAIL.test(email) ? email : null;
}

function cleanAttendees(value: unknown): { email: string; name: string | null }[] | null {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > MAX_GUESTS) return null;
	const out: { email: string; name: string | null }[] = [];
	for (const item of value) {
		const raw = typeof item === 'string' ? { email: item } : item;
		if (!raw || typeof raw !== 'object') return null;
		const email = cleanEmail((raw as { email?: unknown }).email);
		if (!email) return null;
		const nameValue = (raw as { name?: unknown }).name;
		const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim().slice(0, 120) : null;
		if (!out.some((existing) => existing.email === email)) out.push({ email, name });
	}
	return out;
}

export function cleanReminders(value: unknown): number[] | null {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > MAX_REMINDERS) return null;
	const out = new Set<number>();
	for (const item of value) {
		if (!Number.isInteger(item) || item < 0 || item > 40_320) return null;
		out.add(item);
	}
	return [...out].sort((a, b) => a - b);
}

/** Checks and normalises a client event. Times become UTC ISO; all-day ends are exclusive dates. */
export function validateEventInput(body: unknown, calendarIds: readonly string[]): { ok: true; value: ValidEvent } | { ok: false; error: string } {
	if (!body || typeof body !== 'object') return { ok: false, error: 'Expected an event.' };
	const input = body as Record<string, unknown>;
	const calendarId = typeof input.calendarId === 'string' ? input.calendarId : '';
	if (!calendarIds.includes(calendarId)) return { ok: false, error: 'Choose one of your calendars.' };
	const title = cleanText(input.title, MAX_TITLE);
	if (title === null) return { ok: false, error: `Keep the title under ${MAX_TITLE} characters.` };
	const location = cleanText(input.location, MAX_LOCATION);
	if (location === null) return { ok: false, error: `Keep the location under ${MAX_LOCATION} characters.` };
	const description = cleanText(input.description, MAX_DESCRIPTION);
	if (description === null) return { ok: false, error: 'The description is too long.' };
	if (typeof input.allDay !== 'boolean') return { ok: false, error: 'Say whether the event lasts all day.' };
	if (!isValidTimeZone(input.timeZone)) return { ok: false, error: 'Unknown time zone.' };
	const timeZone = input.timeZone;

	let start: string;
	let end: string;
	let startDate: DateKey;
	if (input.allDay) {
		if (!isDateKey(input.start) || !isDateKey(input.end)) return { ok: false, error: 'Use valid dates.' };
		const days = diffDays(input.start, input.end);
		if (days < 1) return { ok: false, error: 'The event must end after it starts.' };
		if (days > MAX_EVENT_DAYS) return { ok: false, error: 'Events can last up to 1000 days.' };
		start = input.start;
		end = input.end;
		startDate = start;
	} else {
		const startMs = cleanInstant(input.start);
		const endMs = cleanInstant(input.end);
		if (startMs === null || endMs === null) return { ok: false, error: 'Use valid start and end times.' };
		if (endMs < startMs) return { ok: false, error: 'The event must end after it starts.' };
		if (endMs - startMs > MAX_EVENT_DAYS * 86_400_000) return { ok: false, error: 'Events can last up to 1000 days.' };
		start = new Date(startMs).toISOString();
		end = new Date(endMs).toISOString();
		startDate = zonedParts(startMs, timeZone).date;
	}

	let rule: Recurrence | null = null;
	if (input.rrule !== null && input.rrule !== undefined && input.rrule !== '') {
		rule = parseRecurrence(input.rrule);
		if (!rule) return { ok: false, error: 'That repeat rule is not supported.' };
		if (rule.until && rule.until < startDate) return { ok: false, error: 'The repeat must end after the first event.' };
	}

	const attendees = cleanAttendees(input.attendees);
	if (!attendees) return { ok: false, error: `Add up to ${MAX_GUESTS} guests with valid email addresses.` };
	const reminders = cleanReminders(input.reminders);
	if (!reminders) return { ok: false, error: `Add up to ${MAX_REMINDERS} reminders, each up to four weeks before.` };

	return {
		ok: true,
		value: { calendarId, title, location, description, allDay: input.allDay, start, end, timeZone, rrule: rule ? formatRecurrence(rule) : null, rule, attendees, reminders }
	};
}

// ---------------------------------------------------------------------------
// Series helpers

function readJson<T>(value: string | null, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

const STATUSES: AttendeeStatus[] = ['needs-action', 'accepted', 'tentative', 'declined'];

export function readStatus(value: unknown): AttendeeStatus | null {
	return STATUSES.includes(value as AttendeeStatus) ? (value as AttendeeStatus) : null;
}

export function readAttendees(row: Pick<EventRow, 'attendees'>): Attendee[] {
	const parsed = readJson<unknown>(row.attendees, []);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter((item): item is { email: string; name?: string | null; status?: string } => Boolean(item) && typeof item.email === 'string')
		.map((item) => ({ email: item.email, name: item.name ?? null, status: readStatus(item.status) ?? 'needs-action' }));
}

export function readOrganizer(row: Pick<EventRow, 'organizer'>): Organizer | null {
	const parsed = readJson<{ email?: unknown; name?: unknown } | null>(row.organizer, null);
	return parsed && typeof parsed.email === 'string' ? { email: parsed.email, name: typeof parsed.name === 'string' ? parsed.name : null } : null;
}

export function readReminders(row: Pick<EventRow, 'reminders'>): number[] {
	return cleanReminders(readJson<unknown>(row.reminders, [])) ?? [];
}

/** Keeps each guest's answer when the guest list is edited. */
export function mergeAttendees(existing: Attendee[], next: { email: string; name: string | null }[]): Attendee[] {
	return next.map((guest) => {
		const before = existing.find((item) => item.email === guest.email);
		return { email: guest.email, name: guest.name ?? before?.name ?? null, status: before?.status ?? 'needs-action' };
	});
}

export function readExdates(row: Pick<EventRow, 'exdates'>): DateKey[] {
	try {
		const parsed = JSON.parse(row.exdates);
		return Array.isArray(parsed) ? parsed.filter(isDateKey) : [];
	} catch {
		return [];
	}
}

type Timing = Pick<EventRow, 'all_day' | 'start_at' | 'end_at' | 'time_zone'>;

export function seriesSpec(row: Timing, rule: Recurrence, exdates: DateKey[] = []): SeriesSpec {
	if (row.all_day) {
		return { rule, allDay: true, startDate: row.start_at, startMinutes: 0, duration: diffDays(row.start_at, row.end_at), timeZone: row.time_zone, exdates };
	}
	const startMs = Date.parse(row.start_at);
	const local = zonedParts(startMs, row.time_zone);
	return { rule, allDay: false, startDate: local.date, startMinutes: local.minutes, duration: Date.parse(row.end_at) - startMs, timeZone: row.time_zone, exdates };
}

/** End of the final occurrence (comparable with start_at), or null for an open-ended series. */
export function recurUntil(row: Timing, rule: Recurrence | null): string | null {
	if (!rule) return null;
	const last = lastOccurrence(seriesSpec(row, rule));
	if (!last) return null;
	return row.all_day ? last.endDate : new Date(last.endMs).toISOString();
}

export function firstDate(row: Timing): DateKey {
	return row.all_day ? row.start_at : zonedParts(Date.parse(row.start_at), row.time_zone).date;
}

// ---------------------------------------------------------------------------
// Reading

export type Window = { fromDate: DateKey; toDate: DateKey; timeZone: string };

export function clampWindow(fromDate: DateKey, toDate: DateKey): boolean {
	const days = diffDays(fromDate, toDate);
	return days > 0 && days <= MAX_RANGE_DAYS;
}

export function occurrenceFrom(row: EventRow, timing: { start: string; end: string }, key: DateKey | null): CalendarOccurrence {
	return {
		id: key ? `${row.id}:${key}` : row.id,
		eventId: row.id,
		calendarId: row.calendar_id,
		title: row.title,
		description: row.description,
		location: row.location,
		allDay: Boolean(row.all_day),
		start: timing.start,
		end: timing.end,
		timeZone: row.time_zone,
		rrule: row.rrule,
		occurrenceKey: key,
		seriesStart: row.start_at,
		seriesEnd: row.end_at,
		attendees: readAttendees(row),
		organizer: readOrganizer(row),
		myStatus: row.my_email ? (readStatus(row.my_status) ?? 'needs-action') : null,
		reminders: readReminders(row)
	};
}

/** Every event appearance overlapping the window's days (in the viewer's zone). */
export async function listOccurrences(db: D1Database, userId: string, window: Window): Promise<CalendarOccurrence[]> {
	const fromMs = startOfDayUtc(window.fromDate, window.timeZone);
	const toMs = startOfDayUtc(window.toDate, window.timeZone);
	// Text bounds padded by a day cover both date-only and ISO values; exact filtering follows.
	const lower = addDays(window.fromDate, -1);
	const upper = addDays(window.toDate, 1);
	const { results } = await db
		.prepare(
			`SELECT ${EVENT_COLUMNS}
			 FROM calendar_events
			 WHERE user_id = ? AND start_at < ? AND (my_status IS NULL OR my_status != 'declined')
			   AND ((rrule IS NULL AND end_at > ?) OR (rrule IS NOT NULL AND (recur_until IS NULL OR recur_until > ?)))
			 ORDER BY start_at
			 LIMIT 5000`
		)
		.bind(userId, upper, lower, lower)
		.all<EventRow>();

	const out: CalendarOccurrence[] = [];
	for (const row of results) {
		const rule = row.rrule ? parseRecurrence(row.rrule) : null;
		if (!rule) {
			const inside = row.all_day
				? row.start_at < window.toDate && row.end_at > window.fromDate
				: Date.parse(row.start_at) < toMs && Date.parse(row.end_at) > fromMs;
			// A zero-length event at the window start still belongs to the first day.
			const instant = !row.all_day && row.start_at === row.end_at && Date.parse(row.start_at) >= fromMs && Date.parse(row.start_at) < toMs;
			if (inside || instant) out.push(occurrenceFrom(row, { start: row.start_at, end: row.end_at }, null));
			continue;
		}
		const spec = seriesSpec(row, rule, readExdates(row));
		for (const occurrence of expandSeries(spec, { fromMs, toMs, fromDate: window.fromDate, toDate: window.toDate }, 1000)) {
			const timing = row.all_day
				? { start: occurrence.startDate, end: occurrence.endDate }
				: { start: new Date(occurrence.startMs).toISOString(), end: new Date(occurrence.endMs).toISOString() };
			out.push(occurrenceFrom(row, timing, occurrence.key));
		}
		if (out.length >= MAX_OCCURRENCES) break;
	}
	return out.sort((a, b) => sortKey(a, window.timeZone).localeCompare(sortKey(b, window.timeZone)));
}

function sortKey(occurrence: CalendarOccurrence, timeZone: string): string {
	if (occurrence.allDay) return `${occurrence.start} 0`;
	const ms = Date.parse(occurrence.start);
	return `${zonedParts(ms, timeZone).date} 1${occurrence.start}`;
}

export async function getEvent(db: D1Database, userId: string, id: string): Promise<EventRow | null> {
	return db
		.prepare(
			`SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE id = ? AND user_id = ?`
		)
		.bind(id, userId)
		.first<EventRow>();
}

// ---------------------------------------------------------------------------
// Writing

/** Invitation fields stored alongside an event. Omitted fields take their defaults. */
export type EventExtras = {
	icalUid?: string;
	recurrenceId?: DateKey | null;
	sequence?: number;
	organizer?: Organizer | null;
	attendees?: Attendee[];
	myEmail?: string | null;
	myStatus?: AttendeeStatus | null;
};

export function newIcalUid(id: string): string {
	return `${id}@quickmail`;
}

export function insertStatement(db: D1Database, userId: string, id: string, event: ValidEvent, exdates: DateKey[] = [], extras: EventExtras = {}) {
	const timing: Timing = { all_day: event.allDay ? 1 : 0, start_at: event.start, end_at: event.end, time_zone: event.timeZone };
	const attendees = extras.attendees ?? mergeAttendees([], event.attendees);
	return db
		.prepare(
			`INSERT INTO calendar_events(id, user_id, calendar_id, title, description, location, all_day, start_at, end_at, time_zone, rrule, exdates, recur_until,
			   ical_uid, recurrence_id, sequence, organizer, attendees, my_email, my_status, reminders)
			 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			 WHERE (SELECT COUNT(*) FROM calendar_events WHERE user_id = ?) < ?`
		)
		.bind(
			id,
			userId,
			event.calendarId,
			event.title,
			event.description,
			event.location,
			timing.all_day,
			event.start,
			event.end,
			event.timeZone,
			event.rrule,
			JSON.stringify(exdates),
			recurUntil(timing, event.rule),
			extras.icalUid ?? newIcalUid(id),
			extras.recurrenceId ?? null,
			extras.sequence ?? 0,
			extras.organizer ? JSON.stringify(extras.organizer) : null,
			JSON.stringify(attendees),
			extras.myEmail ?? null,
			extras.myStatus ?? null,
			JSON.stringify(event.reminders),
			userId,
			MAX_EVENTS
		);
}

export async function createEvent(db: D1Database, userId: string, event: ValidEvent, extras: EventExtras = {}): Promise<string | null> {
	const id = crypto.randomUUID();
	const result = await insertStatement(db, userId, id, event, [], extras).run();
	return result.meta.changes ? id : null;
}

function updateSeriesStatement(db: D1Database, row: EventRow, changes: { rule: Recurrence | null; exdates: DateKey[] }) {
	return db
		.prepare(`UPDATE calendar_events SET rrule = ?, exdates = ?, recur_until = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
		.bind(changes.rule ? formatRecurrence(changes.rule) : null, JSON.stringify(changes.exdates), recurUntil(row, changes.rule), row.id, row.user_id);
}

function replaceStatement(db: D1Database, row: EventRow, event: ValidEvent, exdates: DateKey[]) {
	const timing: Timing = { all_day: event.allDay ? 1 : 0, start_at: event.start, end_at: event.end, time_zone: event.timeZone };
	return db
		.prepare(
			`UPDATE calendar_events SET calendar_id = ?, title = ?, description = ?, location = ?, all_day = ?, start_at = ?, end_at = ?,
			   time_zone = ?, rrule = ?, exdates = ?, recur_until = ?, attendees = ?, reminders = ?, updated_at = datetime('now')
			 WHERE id = ? AND user_id = ?`
		)
		.bind(
			event.calendarId,
			event.title,
			event.description,
			event.location,
			timing.all_day,
			event.start,
			event.end,
			event.timeZone,
			event.rrule,
			JSON.stringify(exdates),
			recurUntil(timing, event.rule),
			JSON.stringify(mergeAttendees(readAttendees(row), event.attendees)),
			JSON.stringify(event.reminders),
			row.id,
			row.user_id
		);
}

/** Stop a series before `key`. Returns false when `key` is the first date (the whole series goes). */
function endSeriesBefore(row: EventRow, rule: Recurrence, key: DateKey): Recurrence | null {
	if (key <= firstDate(row)) return null;
	const kept: Recurrence = { ...rule, until: addDays(key, -1) };
	if (rule.count) {
		// Count only what happened before the split so the number stays meaningful.
		const before = expandSeries(seriesSpec(row, rule), { fromMs: -Infinity, toMs: Infinity, fromDate: '0000-01-01', toDate: key }, rule.count).filter((o) => o.key < key).length;
		delete kept.until;
		kept.count = Math.max(1, before);
	}
	return kept;
}

/** The new start date of an occurrence-based edit, in the event's zone. */
function inputDate(event: ValidEvent): DateKey {
	return event.allDay ? event.start : zonedParts(Date.parse(event.start), event.timeZone).date;
}

/**
 * Applies an edit. `this` detaches one occurrence into its own event, `following`
 * splits the series at the occurrence, and `all` moves the whole series by the same
 * amount the occurrence moved.
 */
export async function updateEvent(
	db: D1Database,
	userId: string,
	row: EventRow,
	event: ValidEvent,
	scope: EditScope,
	occurrenceKey: DateKey | null
): Promise<{ id: string } | { error: string }> {
	const rule = row.rrule ? parseRecurrence(row.rrule) : null;
	const exdates = readExdates(row);

	if (!rule || !occurrenceKey) {
		await replaceStatement(db, row, event, rule ? exdates : []).run();
		return { id: row.id };
	}

	if (scope === 'this') {
		const detached: ValidEvent = { ...event, rrule: null, rule: null };
		const id = crypto.randomUUID();
		// With guests, the moved date stays part of the invitation (same UID, RECURRENCE-ID).
		const guests = readAttendees(row).length > 0 || event.attendees.length > 0;
		const extras: EventExtras = guests
			? { icalUid: row.ical_uid ?? newIcalUid(row.id), recurrenceId: occurrenceKey, sequence: row.sequence, organizer: readOrganizer(row), attendees: mergeAttendees(readAttendees(row), event.attendees) }
			: {};
		const [, inserted] = await db.batch([
			updateSeriesStatement(db, row, { rule, exdates: [...new Set([...exdates, occurrenceKey])] }),
			insertStatement(db, userId, id, detached, [], extras)
		]);
		if (!inserted.meta.changes) return { error: 'You have reached the event limit.' };
		return { id };
	}

	// Map the edited occurrence back onto the series start.
	const dayDelta = diffDays(occurrenceKey, inputDate(event));
	const shift = (keys: DateKey[]) => keys.map((key) => addDays(key, dayDelta));

	if (scope === 'following' && occurrenceKey > firstDate(row)) {
		const kept = endSeriesBefore(row, rule, occurrenceKey);
		const id = crypto.randomUUID();
		let nextRule = event.rule;
		if (nextRule && event.rrule === row.rrule) {
			// Unchanged rule: carry it on from the new date, with whatever COUNT is left.
			nextRule = retargetRecurrence(nextRule, occurrenceKey, inputDate(event));
			if (rule.count && kept?.count) nextRule = { ...nextRule, count: Math.max(1, rule.count - kept.count) };
		}
		const next: ValidEvent = { ...event, rule: nextRule, rrule: nextRule ? formatRecurrence(nextRule) : null };
		const [, inserted] = await db.batch([
			updateSeriesStatement(db, row, { rule: kept, exdates: exdates.filter((key) => key < occurrenceKey) }),
			insertStatement(db, userId, id, next, nextRule ? shift(exdates.filter((key) => key > occurrenceKey)) : [], {
				organizer: readOrganizer(row),
				attendees: mergeAttendees(readAttendees(row), event.attendees)
			})
		]);
		if (!inserted.meta.changes) return { error: 'You have reached the event limit.' };
		return { id };
	}

	// All occurrences (or "following" from the first one, which is the same thing).
	const oldFirst = firstDate(row);
	const newFirst = addDays(oldFirst, dayDelta);
	let start: string;
	let end: string;
	if (event.allDay) {
		start = newFirst;
		end = addDays(newFirst, diffDays(event.start, event.end));
	} else {
		const local = zonedParts(Date.parse(event.start), event.timeZone);
		const startMs = zonedToUtc(newFirst, local.minutes, event.timeZone);
		start = new Date(startMs).toISOString();
		end = new Date(startMs + (Date.parse(event.end) - Date.parse(event.start))).toISOString();
	}
	let nextRule = event.rule;
	// An unchanged rule follows the series when it moves to another weekday.
	if (nextRule && event.rrule === row.rrule) nextRule = retargetRecurrence(nextRule, oldFirst, newFirst);
	const moved: ValidEvent = { ...event, start, end, rule: nextRule, rrule: nextRule ? formatRecurrence(nextRule) : null };
	await replaceStatement(db, row, moved, nextRule ? shift(exdates) : []).run();
	return { id: row.id };
}

export async function deleteEvent(db: D1Database, row: EventRow, scope: EditScope, occurrenceKey: DateKey | null): Promise<void> {
	const rule = row.rrule ? parseRecurrence(row.rrule) : null;
	if (rule && occurrenceKey && scope !== 'all') {
		if (scope === 'this') {
			await updateSeriesStatement(db, row, { rule, exdates: [...new Set([...readExdates(row), occurrenceKey])] }).run();
			return;
		}
		const kept = endSeriesBefore(row, rule, occurrenceKey);
		if (kept) {
			await updateSeriesStatement(db, row, { rule: kept, exdates: readExdates(row).filter((key) => key < occurrenceKey) }).run();
			return;
		}
	}
	await db.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').bind(row.id, row.user_id).run();
}

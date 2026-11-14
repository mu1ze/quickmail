import type { D1Database } from '@cloudflare/workers-types';
import {
	buildICalendar,
	importRecurrence,
	occurrenceDate,
	parseICalendar,
	resolveTimes,
	MAX_ICS_BYTES,
	type ICalEvent,
	type ICalendar,
	type OutEvent
} from '$lib/calendar/ical';
import { formatRecurrence } from '$lib/calendar/recurrence';
import { addDays, diffDays, isValidTimeZone, type DateKey } from '$lib/calendar/time';
import type { CalendarInfo } from '$lib/calendar/types';
import {
	EVENT_COLUMNS,
	insertStatement,
	readAttendees,
	readExdates,
	readOrganizer,
	type EventRow,
	type ValidEvent
} from './calendar-store';

const MAX_EVENT_MS = 1000 * 86_400_000;
const BATCH = 50;

// ---------------------------------------------------------------------------
// Rows → iCalendar

/** One stored row as an iCalendar event. Exception dates that have their own row are left out. */
export function rowToOutEvent(row: EventRow, options: { overridden?: Set<DateKey>; withPeople?: boolean; seriesStart?: string } = {}): OutEvent {
	const exdates = readExdates(row).filter((date) => !options.overridden?.has(date));
	const organizer = readOrganizer(row);
	return {
		uid: row.ical_uid ?? `${row.id}@quickmail`,
		sequence: row.sequence,
		title: row.title,
		description: row.description,
		location: row.location,
		allDay: Boolean(row.all_day),
		start: row.start_at,
		end: row.end_at,
		timeZone: row.time_zone,
		rrule: row.rrule,
		exdates,
		recurrenceId: row.recurrence_id && options.seriesStart ? { date: row.recurrence_id, seriesStart: options.seriesStart, allDay: Boolean(row.all_day) } : null,
		organizer: options.withPeople && organizer ? organizer : null,
		attendees: options.withPeople ? readAttendees(row).map((person) => ({ ...person, rsvp: true })) : [],
		status: 'CONFIRMED'
	};
}

/**
 * Rows sharing a UID as iCalendar events: the series first, then any single dates
 * moved out of it (as RECURRENCE-ID overrides rather than exception dates).
 */
export function groupToOutEvents(rows: EventRow[], withPeople: boolean): OutEvent[] {
	const master = rows.find((row) => !row.recurrence_id) ?? null;
	const overridden = new Set(rows.filter((row) => row.recurrence_id).map((row) => row.recurrence_id!));
	const out: OutEvent[] = [];
	if (master) out.push(rowToOutEvent(master, { overridden, withPeople }));
	for (const row of rows) {
		if (row === master) continue;
		out.push(rowToOutEvent(row, { withPeople, seriesStart: master?.start_at }));
	}
	return out;
}

/** The private subscribe link: every event from a year back onwards, subscriptions excluded. */
export async function buildFeed(db: D1Database, userId: string, name: string): Promise<string> {
	const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
	const { results } = await db
		.prepare(
			`SELECT ${EVENT_COLUMNS.split(', ').map((column) => `e.${column}`).join(', ')}
			 FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id
			 WHERE e.user_id = ? AND c.source_url IS NULL AND (e.my_status IS NULL OR e.my_status != 'declined')
			   AND ((e.rrule IS NULL AND e.end_at >= ?) OR (e.rrule IS NOT NULL AND (e.recur_until IS NULL OR e.recur_until >= ?)))
			 ORDER BY e.start_at LIMIT 5000`
		)
		.bind(userId, since, since)
		.all<EventRow>();
	const groups = new Map<string, EventRow[]>();
	for (const row of results) {
		const uid = row.ical_uid ?? row.id;
		groups.set(uid, [...(groups.get(uid) ?? []), row]);
	}
	const events = [...groups.values()].flatMap((rows) => groupToOutEvents(rows, true));
	return buildICalendar({ method: 'PUBLISH', name, events });
}

// ---------------------------------------------------------------------------
// iCalendar → rows

export type ImportResult = { added: number; updated: number; simplified: number; skipped: number };

type Prepared = { event: ValidEvent; exdates: DateKey[]; uid: string; recurrenceId: DateKey | null; sequence: number };

function clip(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

/** Turns one UID's events into rows ready to insert; the series first. */
export function prepareGroup(events: ICalEvent[], calendar: ICalendar, calendarId: string, fallbackZone: string): { rows: Prepared[]; simplified: boolean } {
	const zone = calendar.timeZone ?? fallbackZone;
	const master = events.find((event) => !event.recurrenceId) ?? null;
	const overrides = events.filter((event) => event.recurrenceId);
	const rows: Prepared[] = [];
	let simplified = false;
	const toEvent = (source: ICalEvent, allowRule: boolean) => {
		const times = resolveTimes(source, zone, calendar.zones);
		const year = Number(times.start.slice(0, 4));
		if (year < 1900 || year > 2200) return null;
		let end = times.end;
		if (times.allDay && diffDays(times.start, end) > 1000) end = addDays(times.start, 1000);
		if (!times.allDay && Date.parse(end) - Date.parse(times.start) > MAX_EVENT_MS) end = new Date(Date.parse(times.start) + MAX_EVENT_MS).toISOString();
		const rule = allowRule && source.rrule ? importRecurrence(source.rrule, times) : null;
		if (allowRule && source.rrule && !rule) simplified = true;
		const event: ValidEvent = {
			calendarId,
			title: clip(source.summary || '(No title)', 300),
			description: clip(source.description, 10_000),
			location: clip(source.location, 500),
			allDay: times.allDay,
			start: times.start,
			end,
			timeZone: isValidTimeZone(times.timeZone) ? times.timeZone : 'UTC',
			rrule: rule ? formatRecurrence(rule) : null,
			rule,
			attendees: [],
			reminders: []
		};
		return { event, times };
	};
	let masterTimes: ReturnType<typeof resolveTimes> | null = null;
	let repeats = false;
	if (master && master.status !== 'CANCELLED') {
		const built = toEvent(master, true);
		if (built) {
			masterTimes = built.times;
			repeats = Boolean(built.event.rule);
			const exdates = built.event.rule
				? [...new Set([...master.exdates, ...overrides.map((o) => o.recurrenceId!)].map((value) => occurrenceDate(value, built.times, calendar.zones)))].slice(0, 1000)
				: [];
			rows.push({ event: built.event, exdates, uid: master.uid, recurrenceId: null, sequence: master.sequence });
		}
	}
	for (const override of overrides) {
		if (override.status === 'CANCELLED') continue;
		const built = toEvent(override, false);
		if (!built) continue;
		const key = occurrenceDate(override.recurrenceId!, masterTimes ?? built.times, calendar.zones);
		rows.push({ event: built.event, exdates: [], uid: override.uid, recurrenceId: repeats || !master ? key : null, sequence: override.sequence });
	}
	return { rows, simplified };
}

export function groupByUid(events: ICalEvent[]): Map<string, ICalEvent[]> {
	const groups = new Map<string, ICalEvent[]>();
	for (const event of events) groups.set(event.uid, [...(groups.get(event.uid) ?? []), event]);
	return groups;
}

/** Runs statements in chunks; reports which ones changed a row. */
async function runBatches(db: D1Database, statements: ReturnType<D1Database['prepare']>[]): Promise<boolean[]> {
	const changed: boolean[] = [];
	for (let i = 0; i < statements.length; i += BATCH) {
		const results = await db.batch(statements.slice(i, i + BATCH));
		for (const result of results) changed.push(Boolean(result.meta.changes));
	}
	return changed;
}

/**
 * Adds a calendar file's events to a calendar. Events already imported (same UID in
 * the same calendar) are replaced. Guests are dropped: an import is a copy, not an
 * invitation, so editing it never emails anyone.
 */
export async function importICalendar(
	db: D1Database,
	userId: string,
	calendarId: string,
	calendar: ICalendar,
	fallbackZone: string,
	options: { replaceAll?: boolean; skipEndedBefore?: string } = {}
): Promise<ImportResult> {
	const result: ImportResult = { added: 0, updated: 0, simplified: 0, skipped: 0 };
	const groups = groupByUid(calendar.events);
	const prepared: Prepared[] = [];
	for (const events of groups.values()) {
		const group = prepareGroup(events, calendar, calendarId, fallbackZone);
		if (group.simplified) result.simplified++;
		for (const row of group.rows) {
			if (options.skipEndedBefore && !row.event.rule && row.event.end < options.skipEndedBefore) continue;
			prepared.push(row);
		}
	}
	const statements: ReturnType<D1Database['prepare']>[] = [];
	const existing = new Set<string>();
	if (options.replaceAll) {
		statements.push(db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND calendar_id = ?').bind(userId, calendarId));
	} else {
		const uids = [...groups.keys()];
		for (let i = 0; i < uids.length; i += BATCH) {
			const chunk = uids.slice(i, i + BATCH);
			const { results } = await db
				.prepare(`SELECT DISTINCT ical_uid FROM calendar_events WHERE user_id = ? AND calendar_id = ? AND ical_uid IN (${chunk.map(() => '?').join(',')})`)
				.bind(userId, calendarId, ...chunk)
				.all<{ ical_uid: string }>();
			for (const row of results) {
				existing.add(row.ical_uid);
				statements.push(db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND calendar_id = ? AND ical_uid = ?').bind(userId, calendarId, row.ical_uid));
			}
		}
	}
	const deletes = statements.length;
	for (const row of prepared) {
		statements.push(insertStatement(db, userId, crypto.randomUUID(), row.event, row.exdates, { icalUid: row.uid, recurrenceId: row.recurrenceId, sequence: row.sequence }));
	}
	const changed = (await runBatches(db, statements)).slice(deletes);
	const inserted = new Set<string>();
	prepared.forEach((row, index) => {
		if (changed[index]) inserted.add(row.uid);
		else result.skipped++;
	});
	for (const uid of inserted) {
		if (existing.has(uid)) result.updated++;
		else result.added++;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Subscriptions

/** webcal:// links become https://; only public http(s) URLs are fetched. */
export function normalizeFeedUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().replace(/^webcals?:\/\//i, 'https://');
	if (!trimmed || trimmed.length > 2000) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		const host = url.hostname.toLowerCase();
		if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export async function fetchCalendarText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetchImpl(url, { headers: { Accept: 'text/calendar, */*;q=0.5', 'User-Agent': 'QuickMail-Calendar/1.0' }, redirect: 'follow', signal: controller.signal });
		if (!response.ok) throw new Error(`The calendar link answered with ${response.status}.`);
		const declared = Number(response.headers.get('content-length') ?? 0);
		if (declared > MAX_ICS_BYTES) throw new Error('That calendar is too large to subscribe to.');
		const reader = response.body?.getReader();
		if (!reader) return '';
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_ICS_BYTES) {
				await reader.cancel();
				throw new Error('That calendar is too large to subscribe to.');
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return new TextDecoder().decode(bytes);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw new Error('The calendar link took too long to answer.');
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Re-reads a subscribed calendar and replaces its events. Records any error on the calendar. */
export async function syncSubscription(db: D1Database, userId: string, calendar: Pick<CalendarInfo, 'id' | 'source_url'>, fallbackZone: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> {
	if (!calendar.source_url) return { ok: false, error: 'This calendar is not a subscription.' };
	try {
		const text = await fetchCalendarText(calendar.source_url, fetchImpl);
		const parsed = parseICalendar(text);
		const skipEndedBefore = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
		const result = await importICalendar(db, userId, calendar.id, parsed, fallbackZone, { replaceAll: true, skipEndedBefore });
		await db.prepare(`UPDATE calendars SET synced_at = datetime('now'), sync_error = NULL WHERE id = ? AND user_id = ?`).bind(calendar.id, userId).run();
		return { ok: true, result };
	} catch (error) {
		const message = error instanceof Error ? error.message.slice(0, 300) : 'The calendar could not be read.';
		await db.prepare(`UPDATE calendars SET synced_at = datetime('now'), sync_error = ? WHERE id = ? AND user_id = ?`).bind(message, calendar.id, userId).run();
		return { ok: false, error: message };
	}
}

/** Refreshes a few subscriptions that have not been read in six hours. Called by the scheduler. */
export async function refreshDueSubscriptions(db: D1Database, fetchImpl: typeof fetch = fetch, limit = 3): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT c.id, c.user_id, c.source_url, COALESCE(s.time_zone, 'UTC') AS time_zone
			 FROM calendars c LEFT JOIN calendar_settings s ON s.user_id = c.user_id
			 WHERE c.source_url IS NOT NULL AND (c.synced_at IS NULL OR c.synced_at < datetime('now', '-6 hours'))
			 ORDER BY c.synced_at IS NOT NULL, c.synced_at LIMIT ?`
		)
		.bind(limit)
		.all<{ id: string; user_id: string; source_url: string; time_zone: string }>();
	for (const row of results) await syncSubscription(db, row.user_id, row, row.time_zone, fetchImpl);
	return results.length;
}

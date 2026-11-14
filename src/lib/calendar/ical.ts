/**
 * Reading and writing iCalendar (RFC 5545) for invitations, imports, subscriptions
 * and the subscribe link. Only what QuickMail stores is mapped: one or more VEVENTs
 * with times, a repeat rule from the supported subset, exception dates, organizer
 * and attendees. Unknown properties are ignored rather than rejected.
 */
import { formatRecurrence, parseRecurrence, type Recurrence } from './recurrence';
import {
	addDays,
	diffDays,
	isDateKey,
	isValidTimeZone,
	pad,
	splitDateKey,
	weekday,
	zoneOffset,
	zonedParts,
	zonedToUtc,
	type DateKey
} from './time';

export const MAX_ICS_BYTES = 3 * 1024 * 1024;
const MAX_LINES = 200_000;
const MAX_EVENTS = 5000;

export type ICalProperty = { name: string; params: Record<string, string>; value: string };
export type ICalComponent = { name: string; props: ICalProperty[]; children: ICalComponent[] };

/** A DATE (minutes null) or DATE-TIME value as written, before any zone is applied. */
export type ICalDateValue = { date: DateKey; minutes: number | null; seconds: number; utc: boolean; tzid: string | null };

export type ICalPerson = { email: string; name: string | null; partstat: string | null; rsvp: boolean };

export type ICalEvent = {
	uid: string;
	sequence: number;
	summary: string;
	description: string;
	location: string;
	status: string | null;
	start: ICalDateValue;
	end: ICalDateValue | null;
	/** From DURATION when there is no DTEND: ms for timed events, whole days for dates. */
	duration: number | null;
	rrule: string | null;
	exdates: ICalDateValue[];
	recurrenceId: ICalDateValue | null;
	organizer: ICalPerson | null;
	attendees: ICalPerson[];
};

export type ICalendar = {
	method: string | null;
	name: string | null;
	/** X-WR-TIMEZONE: the calendar's own zone, used for floating times. */
	timeZone: string | null;
	events: ICalEvent[];
	/** VTIMEZONE offsets by TZID, for zones that are not IANA names. */
	zones: Map<string, { standard: number | null; daylight: number | null }>;
};

// ---------------------------------------------------------------------------
// Parsing

function unfold(text: string): string[] {
	return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): ICalProperty | null {
	let i = 0;
	let quoted = false;
	let nameEnd = -1;
	for (; i < line.length; i++) {
		const char = line[i];
		if (char === '"') quoted = !quoted;
		else if (!quoted && (char === ';' || char === ':')) {
			if (nameEnd < 0) nameEnd = i;
			if (char === ':') break;
		}
	}
	if (i >= line.length || nameEnd < 1) return null;
	const name = line.slice(0, nameEnd).toUpperCase();
	const params: Record<string, string> = {};
	const paramText = line.slice(nameEnd + 1, i);
	if (line[nameEnd] === ';' && paramText) {
		let current = '';
		quoted = false;
		const parts: string[] = [];
		for (const char of paramText) {
			if (char === '"') quoted = !quoted;
			if (char === ';' && !quoted) {
				parts.push(current);
				current = '';
			} else current += char;
		}
		parts.push(current);
		for (const part of parts) {
			const eq = part.indexOf('=');
			if (eq < 1) continue;
			params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
		}
	}
	return { name, params, value: line.slice(i + 1) };
}

/** Top-level components (normally a single VCALENDAR). */
export function parseComponents(text: string): ICalComponent[] {
	const roots: ICalComponent[] = [];
	const stack: ICalComponent[] = [];
	const lines = unfold(text);
	if (lines.length > MAX_LINES) throw new Error('This calendar file is too large.');
	for (const raw of lines) {
		if (!raw.trim()) continue;
		const prop = parseLine(raw);
		if (!prop) continue;
		if (prop.name === 'BEGIN') {
			if (stack.length >= 8) throw new Error('This calendar file is nested too deeply.');
			const component: ICalComponent = { name: prop.value.trim().toUpperCase(), props: [], children: [] };
			(stack.at(-1)?.children ?? roots).push(component);
			stack.push(component);
		} else if (prop.name === 'END') {
			if (stack.at(-1)?.name === prop.value.trim().toUpperCase()) stack.pop();
		} else stack.at(-1)?.props.push(prop);
	}
	return roots;
}

export function unescapeText(value: string): string {
	return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

function prop(component: ICalComponent, name: string): ICalProperty | undefined {
	return component.props.find((item) => item.name === name);
}

function text(component: ICalComponent, name: string): string {
	const found = prop(component, name);
	return found ? unescapeText(found.value).trim() : '';
}

export function parseDateValue(property: ICalProperty | undefined): ICalDateValue | null {
	if (!property) return null;
	return parseDateText(property.value.trim(), property.params.TZID ?? null, property.params.VALUE === 'DATE');
}

function parseDateText(value: string, tzid: string | null, dateOnly: boolean): ICalDateValue | null {
	const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
	if (!match) return null;
	const date = `${match[1]}-${match[2]}-${match[3]}`;
	if (!isDateKey(date)) return null;
	if (!match[4] || dateOnly) return { date, minutes: null, seconds: 0, utc: false, tzid: null };
	const hours = Number(match[4]);
	const minutes = Number(match[5]);
	if (hours > 23 || minutes > 59) return null;
	return { date, minutes: hours * 60 + minutes, seconds: Number(match[6] ?? 0), utc: Boolean(match[7]), tzid: match[7] ? null : tzid };
}

function parsePerson(property: ICalProperty | undefined): ICalPerson | null {
	if (!property) return null;
	const email = property.value.replace(/^mailto:/i, '').trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
	const name = property.params.CN?.trim() || null;
	return {
		email,
		name: name && name.toLowerCase() !== email ? name : null,
		partstat: property.params.PARTSTAT?.toUpperCase() ?? null,
		rsvp: property.params.RSVP?.toUpperCase() === 'TRUE'
	};
}

/** RFC 5545 DURATION → ms (or days when `days` is set). */
export function parseDuration(value: string, days = false): number | null {
	const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
	if (!match || value.trim() === 'P' || value.trim().endsWith('T')) return null;
	const [, sign, w, d, h, m, s] = match;
	const total = (Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400_000 + Number(h ?? 0) * 3_600_000 + Number(m ?? 0) * 60_000 + Number(s ?? 0) * 1000;
	const signed = sign === '-' ? -total : total;
	return days ? Math.round(signed / 86_400_000) : signed;
}

function parseOffset(value: string | undefined): number | null {
	const match = value ? /^([+-])(\d{2})(\d{2})/.exec(value.trim()) : null;
	if (!match) return null;
	const minutes = Number(match[2]) * 60 + Number(match[3]);
	return match[1] === '-' ? -minutes : minutes;
}

function parseEvent(component: ICalComponent): ICalEvent | null {
	const uid = text(component, 'UID');
	const start = parseDateValue(prop(component, 'DTSTART'));
	if (!uid || uid.length > 500 || !start) return null;
	const durationText = prop(component, 'DURATION')?.value;
	const exdates: ICalDateValue[] = [];
	for (const item of component.props.filter((p) => p.name === 'EXDATE')) {
		for (const part of item.value.split(',')) {
			const parsed = parseDateText(part.trim(), item.params.TZID ?? null, item.params.VALUE === 'DATE');
			if (parsed) exdates.push(parsed);
		}
	}
	const sequence = Number(prop(component, 'SEQUENCE')?.value ?? 0);
	return {
		uid,
		sequence: Number.isInteger(sequence) && sequence >= 0 ? Math.min(sequence, 1_000_000) : 0,
		summary: text(component, 'SUMMARY'),
		description: text(component, 'DESCRIPTION'),
		location: text(component, 'LOCATION'),
		status: prop(component, 'STATUS')?.value.trim().toUpperCase() ?? null,
		start,
		end: parseDateValue(prop(component, 'DTEND')),
		duration: durationText ? parseDuration(durationText, start.minutes === null) : null,
		rrule: prop(component, 'RRULE')?.value.trim() ?? null,
		exdates: exdates.slice(0, 1000),
		recurrenceId: parseDateValue(prop(component, 'RECURRENCE-ID')),
		organizer: parsePerson(prop(component, 'ORGANIZER')),
		attendees: component.props
			.filter((p) => p.name === 'ATTENDEE')
			.map(parsePerson)
			.filter((p): p is ICalPerson => p !== null)
			.slice(0, 200)
	};
}

export function parseICalendar(source: string): ICalendar {
	if (source.length > MAX_ICS_BYTES) throw new Error('This calendar file is too large.');
	const calendar = parseComponents(source).find((component) => component.name === 'VCALENDAR');
	if (!calendar) throw new Error('This is not a calendar file.');
	const zones = new Map<string, { standard: number | null; daylight: number | null }>();
	for (const zone of calendar.children.filter((child) => child.name === 'VTIMEZONE')) {
		const tzid = text(zone, 'TZID');
		const offset = (name: string) => {
			const parts = zone.children.filter((child) => child.name === name);
			return parts.length ? parseOffset(prop(parts.at(-1)!, 'TZOFFSETTO')?.value) : null;
		};
		if (tzid) zones.set(tzid, { standard: offset('STANDARD'), daylight: offset('DAYLIGHT') });
	}
	const events: ICalEvent[] = [];
	for (const child of calendar.children) {
		if (child.name !== 'VEVENT') continue;
		const event = parseEvent(child);
		if (event) events.push(event);
		if (events.length >= MAX_EVENTS) break;
	}
	const zoneName = text(calendar, 'X-WR-TIMEZONE');
	return {
		method: prop(calendar, 'METHOD')?.value.trim().toUpperCase() ?? null,
		name: text(calendar, 'X-WR-CALNAME') || null,
		timeZone: isValidTimeZone(zoneName) ? zoneName : null,
		events,
		zones
	};
}

// ---------------------------------------------------------------------------
// Time zones

/** Windows zone names sent by Outlook and Exchange. */
const WINDOWS_ZONES: Record<string, string> = {
	'Dateline Standard Time': 'Etc/GMT+12',
	'Hawaiian Standard Time': 'Pacific/Honolulu',
	'Alaskan Standard Time': 'America/Anchorage',
	'Pacific Standard Time': 'America/Los_Angeles',
	'Pacific Standard Time (Mexico)': 'America/Tijuana',
	'US Mountain Standard Time': 'America/Phoenix',
	'Mountain Standard Time': 'America/Denver',
	'Mountain Standard Time (Mexico)': 'America/Mazatlan',
	'Central Standard Time': 'America/Chicago',
	'Central Standard Time (Mexico)': 'America/Mexico_City',
	'Canada Central Standard Time': 'America/Regina',
	'Central America Standard Time': 'America/Guatemala',
	'Eastern Standard Time': 'America/New_York',
	'US Eastern Standard Time': 'America/Indiana/Indianapolis',
	'SA Pacific Standard Time': 'America/Bogota',
	'Atlantic Standard Time': 'America/Halifax',
	'Venezuela Standard Time': 'America/Caracas',
	'Pacific SA Standard Time': 'America/Santiago',
	'Newfoundland Standard Time': 'America/St_Johns',
	'E. South America Standard Time': 'America/Sao_Paulo',
	'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
	'SA Eastern Standard Time': 'America/Cayenne',
	'UTC': 'UTC',
	'Coordinated Universal Time': 'UTC',
	'GMT Standard Time': 'Europe/London',
	'Greenwich Standard Time': 'Atlantic/Reykjavik',
	'W. Europe Standard Time': 'Europe/Berlin',
	'Central Europe Standard Time': 'Europe/Budapest',
	'Romance Standard Time': 'Europe/Paris',
	'Central European Standard Time': 'Europe/Warsaw',
	'W. Central Africa Standard Time': 'Africa/Lagos',
	'GTB Standard Time': 'Europe/Bucharest',
	'E. Europe Standard Time': 'Europe/Chisinau',
	'FLE Standard Time': 'Europe/Kiev',
	'Israel Standard Time': 'Asia/Jerusalem',
	'Egypt Standard Time': 'Africa/Cairo',
	'South Africa Standard Time': 'Africa/Johannesburg',
	'Turkey Standard Time': 'Europe/Istanbul',
	'Russian Standard Time': 'Europe/Moscow',
	'Arab Standard Time': 'Asia/Riyadh',
	'E. Africa Standard Time': 'Africa/Nairobi',
	'Iran Standard Time': 'Asia/Tehran',
	'Arabian Standard Time': 'Asia/Dubai',
	'Pakistan Standard Time': 'Asia/Karachi',
	'India Standard Time': 'Asia/Kolkata',
	'Nepal Standard Time': 'Asia/Kathmandu',
	'Bangladesh Standard Time': 'Asia/Dhaka',
	'SE Asia Standard Time': 'Asia/Bangkok',
	'China Standard Time': 'Asia/Shanghai',
	'Singapore Standard Time': 'Asia/Singapore',
	'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
	'Taipei Standard Time': 'Asia/Taipei',
	'W. Australia Standard Time': 'Australia/Perth',
	'Tokyo Standard Time': 'Asia/Tokyo',
	'Korea Standard Time': 'Asia/Seoul',
	'Cen. Australia Standard Time': 'Australia/Adelaide',
	'E. Australia Standard Time': 'Australia/Brisbane',
	'AUS Eastern Standard Time': 'Australia/Sydney',
	'New Zealand Standard Time': 'Pacific/Auckland'
};

const DISPLAY_ZONES: [RegExp, string][] = [
	[/eastern time/i, 'America/New_York'],
	[/central time/i, 'America/Chicago'],
	[/mountain time/i, 'America/Denver'],
	[/pacific time/i, 'America/Los_Angeles'],
	[/atlantic time/i, 'America/Halifax']
];

/**
 * An IANA zone for a TZID: IANA names pass through, Windows and display names are
 * mapped, prefixed ids (/mozilla.org/…/Europe/Paris) are trimmed, and an unknown id
 * is matched by its VTIMEZONE offsets. Falls back to `fallback`.
 */
export function resolveZone(tzid: string | null, fallback: string, zones?: ICalendar['zones'], year = new Date().getUTCFullYear()): string {
	if (!tzid) return fallback;
	const id = tzid.trim().replace(/^"|"$/g, '');
	if (isValidTimeZone(id) && id.includes('/')) return id;
	if (id === 'UTC' || id === 'GMT' || id === 'Z') return 'UTC';
	if (WINDOWS_ZONES[id]) return WINDOWS_ZONES[id];
	const tail = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(id)?.[1];
	if (tail && isValidTimeZone(tail)) return tail;
	for (const [pattern, zone] of DISPLAY_ZONES) if (pattern.test(id)) return zone;
	const offsets = zones?.get(id);
	if (offsets?.standard !== null && offsets?.standard !== undefined) {
		const wanted = [offsets.standard, offsets.daylight ?? offsets.standard].sort((a, b) => a - b).join(',');
		const january = Date.UTC(year, 0, 15);
		const july = Date.UTC(year, 6, 15);
		for (const zone of new Set(Object.values(WINDOWS_ZONES))) {
			const pair = [zoneOffset(january, zone), zoneOffset(july, zone)].sort((a, b) => a - b).join(',');
			if (pair === wanted) return zone;
		}
		if (offsets.daylight === null && offsets.standard % 60 === 0) {
			const hours = -offsets.standard / 60;
			const zone = hours === 0 ? 'UTC' : `Etc/GMT${hours > 0 ? '+' : ''}${hours}`;
			if (isValidTimeZone(zone)) return zone;
		}
	}
	return fallback;
}

/** The instant a DATE-TIME value names (DATE values: midnight in `zone`). */
export function instantOf(value: ICalDateValue, zone: string): number {
	if (value.utc) {
		const { year, month, day } = splitDateKey(value.date);
		return Date.UTC(year, month - 1, day, 0, value.minutes ?? 0, value.seconds);
	}
	return zonedToUtc(value.date, value.minutes ?? 0, zone) + value.seconds * 1000;
}

export type ResolvedTimes = {
	allDay: boolean;
	/** Timed: ISO instant. All-day: date. */
	start: string;
	/** Timed: ISO instant. All-day: exclusive end date. */
	end: string;
	timeZone: string;
	/** First date in the event's zone. */
	startDate: DateKey;
};

/** Maps an event's start/end onto QuickMail's storage form. */
export function resolveTimes(event: ICalEvent, fallbackZone: string, zones?: ICalendar['zones']): ResolvedTimes {
	if (event.start.minutes === null) {
		let end = event.end?.date ?? (event.duration ? addDays(event.start.date, Math.max(1, event.duration)) : addDays(event.start.date, 1));
		if (diffDays(event.start.date, end) < 1) end = addDays(event.start.date, 1);
		return { allDay: true, start: event.start.date, end, timeZone: fallbackZone, startDate: event.start.date };
	}
	const zone = event.start.utc ? fallbackZone : resolveZone(event.start.tzid, fallbackZone, zones, Number(event.start.date.slice(0, 4)));
	const startMs = instantOf(event.start, zone);
	let endMs = startMs;
	if (event.end && event.end.minutes !== null) {
		const endZone = event.end.utc ? zone : resolveZone(event.end.tzid, zone, zones, Number(event.end.date.slice(0, 4)));
		endMs = instantOf(event.end, endZone);
	} else if (event.duration !== null) endMs = startMs + event.duration;
	if (endMs < startMs) endMs = startMs;
	return { allDay: false, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), timeZone: zone, startDate: zonedParts(startMs, zone).date };
}

/** An occurrence date (in the event's zone) for an EXDATE or RECURRENCE-ID value. */
export function occurrenceDate(value: ICalDateValue, times: ResolvedTimes, zones?: ICalendar['zones']): DateKey {
	if (value.minutes === null || times.allDay) return value.date;
	const zone = value.utc ? 'UTC' : resolveZone(value.tzid, times.timeZone, zones);
	return zonedParts(instantOf(value, zone), times.timeZone).date;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Normalises a sender's RRULE onto the supported subset. Parts that only restate the
 * start date (BYMONTHDAY=15 on the 15th, BYMONTH in a yearly rule, WKST) are dropped,
 * and BYSETPOS monthly rules become "nth weekday". Returns null when the rule means
 * something QuickMail cannot repeat; callers then keep the first occurrence only.
 */
export function importRecurrence(rrule: string, times: ResolvedTimes): Recurrence | null {
	const fields = new Map<string, string>();
	for (const part of rrule.replace(/^RRULE:/i, '').split(';')) {
		const [key, value] = part.split('=');
		if (key && value !== undefined) fields.set(key.toUpperCase(), value.toUpperCase());
	}
	const start = splitDateKey(times.startDate);
	fields.delete('WKST');
	if (fields.get('BYMONTHDAY') === String(start.day)) fields.delete('BYMONTHDAY');
	if (fields.get('FREQ') === 'YEARLY' && fields.get('BYMONTH') === String(start.month)) fields.delete('BYMONTH');
	if (fields.get('FREQ') === 'WEEKLY' && !fields.has('BYDAY')) fields.set('BYDAY', DAY_CODES[weekday(times.startDate)]);
	const setpos = fields.get('BYSETPOS');
	if (setpos && fields.get('FREQ') === 'MONTHLY' && /^[A-Z]{2}$/.test(fields.get('BYDAY') ?? '')) {
		fields.set('BYDAY', `${setpos}${fields.get('BYDAY')}`);
		fields.delete('BYSETPOS');
	}
	const until = fields.get('UNTIL');
	if (until) {
		const value = parseDateText(until, null, false);
		if (!value) return null;
		const date = value.minutes === null || times.allDay ? value.date : zonedParts(instantOf(value, value.utc ? 'UTC' : times.timeZone), times.timeZone).date;
		fields.set('UNTIL', date.replaceAll('-', ''));
	}
	const rule = parseRecurrence([...fields].map(([key, value]) => `${key}=${value}`).join(';'));
	if (!rule || (rule.until && rule.until < times.startDate)) return null;
	return rule;
}

// ---------------------------------------------------------------------------
// Writing

export function escapeText(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const out: string[] = [];
	let current = '';
	let size = 0;
	for (const char of line) {
		const bytes = encoder.encode(char).length;
		if (size + bytes > (out.length ? 74 : 75)) {
			out.push(current);
			current = '';
			size = 0;
		}
		current += char;
		size += bytes;
	}
	out.push(current);
	return out.join('\r\n ');
}

function formatDate(date: DateKey): string {
	return date.replaceAll('-', '');
}

export function formatUtc(ms: number): string {
	return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatLocal(ms: number, zone: string): string {
	const p = zonedParts(ms, zone);
	return `${formatDate(p.date)}T${pad(p.hour)}${pad(p.minute)}00`;
}

function formatOffset(minutes: number): string {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function paramValue(value: string): string {
	const clean = value.replace(/["\r\n]/g, '').trim();
	return /[;:,]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * A VTIMEZONE built from the platform's zone data: one observance per offset change
 * between `fromYear` and `toYear`, so clients that do not know the IANA name still
 * show the right times.
 */
export function buildVTimezone(zone: string, fromYear: number, toYear: number): string[] {
	const lines = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
	let at = Date.UTC(fromYear, 0, 1);
	const end = Date.UTC(toYear + 1, 0, 1);
	const initial = zoneOffset(at, zone);
	lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${formatOffset(initial)}`, `TZOFFSETTO:${formatOffset(initial)}`, 'END:STANDARD');
	const step = 6 * 3_600_000;
	let offset = initial;
	let transitions = 0;
	while (at < end && transitions < 100) {
		const next = at + step;
		const nextOffset = zoneOffset(next, zone);
		if (nextOffset !== offset) {
			let low = at;
			let high = next;
			while (high - low > 60_000) {
				const mid = Math.floor((low + high) / 2 / 60_000) * 60_000;
				if (zoneOffset(mid, zone) === offset) low = mid;
				else high = mid;
			}
			const kind = nextOffset > offset ? 'DAYLIGHT' : 'STANDARD';
			lines.push(`BEGIN:${kind}`, `DTSTART:${formatUtc(high + offset * 60_000).replace('Z', '')}`, `TZOFFSETFROM:${formatOffset(offset)}`, `TZOFFSETTO:${formatOffset(nextOffset)}`, `END:${kind}`);
			offset = nextOffset;
			transitions++;
		}
		at = next;
	}
	lines.push('END:VTIMEZONE');
	return lines;
}

export type OutPerson = { email: string; name?: string | null; status?: string | null; rsvp?: boolean };

export type OutEvent = {
	uid: string;
	sequence?: number;
	title: string;
	description?: string;
	location?: string;
	status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
	allDay: boolean;
	/** Timed: ISO instant. All-day: date. */
	start: string;
	/** Timed: ISO instant. All-day: exclusive end date. */
	end: string;
	timeZone: string;
	rrule?: string | null;
	exdates?: DateKey[];
	/** An occurrence date this event replaces within its series. */
	recurrenceId?: { date: DateKey; seriesStart: string; allDay: boolean } | null;
	organizer?: OutPerson | null;
	attendees?: OutPerson[];
	url?: string;
	updatedAt?: string;
};

const PARTSTAT: Record<string, string> = {
	accepted: 'ACCEPTED',
	declined: 'DECLINED',
	tentative: 'TENTATIVE',
	'needs-action': 'NEEDS-ACTION'
};

export function partstatToStatus(value: string | null | undefined): 'accepted' | 'declined' | 'tentative' | 'needs-action' {
	switch (value?.toUpperCase()) {
		case 'ACCEPTED':
			return 'accepted';
		case 'DECLINED':
			return 'declined';
		case 'TENTATIVE':
			return 'tentative';
		default:
			return 'needs-action';
	}
}

function eventLines(event: OutEvent, now: number): string[] {
	const lines = ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${formatUtc(now)}`];
	if (event.sequence) lines.push(`SEQUENCE:${event.sequence}`);
	const local = (ms: number) => (event.timeZone === 'UTC' ? `:${formatUtc(ms)}` : `;TZID=${event.timeZone}:${formatLocal(ms, event.timeZone)}`);
	if (event.allDay) {
		lines.push(`DTSTART;VALUE=DATE:${formatDate(event.start)}`, `DTEND;VALUE=DATE:${formatDate(event.end)}`);
	} else {
		lines.push(`DTSTART${local(Date.parse(event.start))}`, `DTEND${local(Date.parse(event.end))}`);
	}
	if (event.rrule) {
		const rule = parseRecurrence(event.rrule);
		if (rule) {
			let value = formatRecurrence(rule);
			if (rule.until && !event.allDay) {
				// UNTIL must match DTSTART's type: the last moment of that day, in UTC.
				value = value.replace(/UNTIL=\d{8}/, `UNTIL=${formatUtc(zonedToUtc(addDays(rule.until, 1), 0, event.timeZone) - 1000)}`);
			}
			lines.push(`RRULE:${value}`);
			if (event.exdates?.length) {
				const startMinutes = event.allDay ? 0 : zonedParts(Date.parse(event.start), event.timeZone).minutes;
				for (const date of event.exdates) {
					if (event.allDay) lines.push(`EXDATE;VALUE=DATE:${formatDate(date)}`);
					else lines.push(`EXDATE${local(zonedToUtc(date, startMinutes, event.timeZone))}`);
				}
			}
		}
	}
	if (event.recurrenceId) {
		const { date, seriesStart, allDay } = event.recurrenceId;
		if (allDay) lines.push(`RECURRENCE-ID;VALUE=DATE:${formatDate(date)}`);
		else lines.push(`RECURRENCE-ID${local(zonedToUtc(date, zonedParts(Date.parse(seriesStart), event.timeZone).minutes, event.timeZone))}`);
	}
	lines.push(`SUMMARY:${escapeText(event.title || '(No title)')}`);
	if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
	if (event.status) lines.push(`STATUS:${event.status}`);
	if (event.url) lines.push(`URL:${event.url}`);
	if (event.updatedAt) {
		const updated = Date.parse(event.updatedAt.includes('T') ? event.updatedAt : `${event.updatedAt.replace(' ', 'T')}Z`);
		if (Number.isFinite(updated)) lines.push(`LAST-MODIFIED:${formatUtc(updated)}`);
	}
	if (event.organizer) {
		lines.push(`ORGANIZER${event.organizer.name ? `;CN=${paramValue(event.organizer.name)}` : ''}:mailto:${event.organizer.email}`);
	}
	for (const person of event.attendees ?? []) {
		const params = [
			person.name ? `CN=${paramValue(person.name)}` : null,
			'ROLE=REQ-PARTICIPANT',
			`PARTSTAT=${PARTSTAT[person.status ?? 'needs-action'] ?? 'NEEDS-ACTION'}`,
			person.rsvp ? 'RSVP=TRUE' : null
		].filter(Boolean);
		lines.push(`ATTENDEE;${params.join(';')}:mailto:${person.email}`);
	}
	lines.push('END:VEVENT');
	return lines;
}

export function buildICalendar(input: { method?: 'REQUEST' | 'REPLY' | 'CANCEL' | 'PUBLISH'; name?: string; events: OutEvent[]; now?: number }): string {
	const now = input.now ?? Date.now();
	const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QuickMail//Calendar//EN', 'CALSCALE:GREGORIAN'];
	if (input.method) lines.push(`METHOD:${input.method}`);
	if (input.name) lines.push(`X-WR-CALNAME:${escapeText(input.name)}`);
	const years = new Map<string, [number, number]>();
	for (const event of input.events) {
		if (event.allDay || event.timeZone === 'UTC') continue;
		const first = Number(event.start.slice(0, 4));
		const last = event.rrule ? Math.max(first + 10, new Date(now).getUTCFullYear() + 3) : Number(event.end.slice(0, 4));
		const span = years.get(event.timeZone);
		years.set(event.timeZone, span ? [Math.min(span[0], first), Math.max(span[1], last)] : [first, last]);
	}
	for (const [zone, [from, to]] of years) lines.push(...buildVTimezone(zone, from, Math.min(to, from + 30)));
	for (const event of input.events) lines.push(...eventLines(event, now));
	lines.push('END:VCALENDAR');
	return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** `20261116` style date for subjects and file names. */
export function compactDate(date: DateKey): string {
	return formatDate(date);
}

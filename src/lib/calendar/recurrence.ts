/**
 * The RFC 5545 RRULE subset QuickMail creates and understands: DAILY / WEEKLY /
 * MONTHLY / YEARLY with INTERVAL, BYDAY (weekdays for weekly, one "nth weekday"
 * for monthly), COUNT and UNTIL. Expansion happens in the event's own time zone so
 * a 9am meeting stays at 9am across daylight-saving changes.
 */
import {
	addDays,
	dateKey,
	daysInMonth,
	diffDays,
	isDateKey,
	monthName,
	splitDateKey,
	startOfWeek,
	weekday,
	weekdayName,
	zonedParts,
	zonedToUtc,
	type DateKey
} from './time';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export type Recurrence = {
	freq: Frequency;
	interval: number;
	/** WEEKLY: weekdays (0 = Sunday). */
	byDay?: number[];
	/** MONTHLY: the nth weekday of the month (n = 1–4, or -1 for last). */
	byWeekdayOfMonth?: { n: number; day: number };
	count?: number;
	/** Last date an occurrence may start on, in the event's zone (inclusive). */
	until?: DateKey;
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export const MAX_COUNT = 1000;
const MAX_INTERVAL = 999;
/** Hard stop for any single expansion so a bad rule cannot spin a Worker. */
const MAX_STEPS = 20_000;

export function parseRecurrence(value: unknown): Recurrence | null {
	if (typeof value !== 'string' || !value || value.length > 300) return null;
	const fields = new Map<string, string>();
	for (const part of value.replace(/^RRULE:/i, '').split(';')) {
		const [key, raw] = part.split('=');
		if (!key || raw === undefined || fields.has(key.toUpperCase())) return null;
		fields.set(key.toUpperCase(), raw.toUpperCase());
	}
	const freq = fields.get('FREQ') as Frequency | undefined;
	if (!freq || !FREQUENCIES.includes(freq)) return null;
	const rule: Recurrence = { freq, interval: 1 };
	for (const [key, raw] of fields) {
		switch (key) {
			case 'FREQ':
				break;
			case 'INTERVAL': {
				const interval = Number(raw);
				if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;
				rule.interval = interval;
				break;
			}
			case 'COUNT': {
				const count = Number(raw);
				if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
				rule.count = count;
				break;
			}
			case 'UNTIL': {
				const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
				const until = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
				if (!isDateKey(until)) return null;
				rule.until = until;
				break;
			}
			case 'BYDAY': {
				const items = raw.split(',');
				if (freq === 'WEEKLY') {
					const days = items.map((code) => DAY_CODES.indexOf(code));
					if (!days.length || days.some((day) => day < 0)) return null;
					rule.byDay = [...new Set(days)].sort((a, b) => a - b);
				} else if (freq === 'MONTHLY' && items.length === 1) {
					const match = /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/.exec(items[0]);
					if (!match) return null;
					rule.byWeekdayOfMonth = { n: Number(match[1]), day: DAY_CODES.indexOf(match[2]) };
				} else return null;
				break;
			}
			case 'WKST':
				if (raw !== 'MO') return null;
				break;
			default:
				return null;
		}
	}
	if (rule.count && rule.until) return null;
	return rule;
}

export function formatRecurrence(rule: Recurrence): string {
	const parts = [`FREQ=${rule.freq}`];
	if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
	if (rule.freq === 'WEEKLY' && rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.map((day) => DAY_CODES[day]).join(',')}`);
	if (rule.freq === 'MONTHLY' && rule.byWeekdayOfMonth) parts.push(`BYDAY=${rule.byWeekdayOfMonth.n}${DAY_CODES[rule.byWeekdayOfMonth.day]}`);
	if (rule.count) parts.push(`COUNT=${rule.count}`);
	else if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
	return parts.join(';');
}

/** Which week of its month a date falls in (1–5), and whether it is the last such weekday. */
export function weekdayOfMonth(date: DateKey): { n: number; last: boolean; day: number } {
	const { year, month, day } = splitDateKey(date);
	return { n: Math.ceil(day / 7), last: day + 7 > daysInMonth(year, month), day: weekday(date) };
}

function nthWeekday(year: number, month: number, n: number, day: number): DateKey | null {
	if (n === -1) {
		const last = dateKey(year, month, daysInMonth(year, month));
		return addDays(last, -((weekday(last) - day + 7) % 7));
	}
	const first = dateKey(year, month, 1);
	const date = addDays(first, ((day - weekday(first) + 7) % 7) + (n - 1) * 7);
	return splitDateKey(date).month === ((month - 1 + 12) % 12) + 1 ? date : null;
}

/** Candidate dates for the rule in order, starting at `start`, beginning at period `from`. */
function* candidateDates(rule: Recurrence, start: DateKey, from: number): Generator<DateKey> {
	const s = splitDateKey(start);
	if (rule.freq === 'DAILY') {
		for (let k = from; ; k++) yield addDays(start, k * rule.interval);
	}
	if (rule.freq === 'WEEKLY') {
		// Weeks run Monday–Sunday (RFC 5545 default WKST=MO).
		const weekStart = startOfWeek(start, 1);
		const days = (rule.byDay?.length ? rule.byDay : [weekday(start)]).map((day) => (day + 6) % 7).sort((a, b) => a - b);
		for (let k = from; ; k++) {
			const base = addDays(weekStart, k * 7 * rule.interval);
			for (const offset of days) {
				const date = addDays(base, offset);
				if (date >= start) yield date;
			}
		}
	}
	if (rule.freq === 'MONTHLY') {
		for (let k = from; ; k++) {
			const total = s.month - 1 + k * rule.interval;
			const year = s.year + Math.floor(total / 12);
			const month = (total % 12) + 1;
			if (rule.byWeekdayOfMonth) {
				const date = nthWeekday(year, month, rule.byWeekdayOfMonth.n, rule.byWeekdayOfMonth.day);
				if (date && date >= start) yield date;
			} else if (s.day <= daysInMonth(year, month)) {
				yield dateKey(year, month, s.day);
			}
		}
	}
	if (rule.freq === 'YEARLY') {
		for (let k = from; ; k++) {
			const year = s.year + k * rule.interval;
			if (s.day <= daysInMonth(year, s.month)) yield dateKey(year, s.month, s.day);
		}
	}
}

/** Periods that can be skipped wholesale before reaching `target` (only safe without COUNT). */
function periodsBefore(rule: Recurrence, start: DateKey, target: DateKey): number {
	if (target <= start) return 0;
	const days = diffDays(start, target);
	switch (rule.freq) {
		case 'DAILY':
			return Math.max(0, Math.floor(days / rule.interval) - 1);
		case 'WEEKLY':
			return Math.max(0, Math.floor(diffDays(startOfWeek(start, 1), target) / (7 * rule.interval)) - 1);
		case 'MONTHLY': {
			const a = splitDateKey(start);
			const b = splitDateKey(target);
			return Math.max(0, Math.floor(((b.year - a.year) * 12 + b.month - a.month) / rule.interval) - 1);
		}
		case 'YEARLY':
			return Math.max(0, Math.floor((splitDateKey(target).year - splitDateKey(start).year) / rule.interval) - 1);
	}
}

export type SeriesSpec = {
	rule: Recurrence;
	allDay: boolean;
	/** First occurrence date in the event's zone. */
	startDate: DateKey;
	/** Timed events: local start minutes in the event's zone. */
	startMinutes: number;
	/** Timed: milliseconds. All-day: whole days. */
	duration: number;
	timeZone: string;
	/** Occurrence dates (event zone) removed from the series. */
	exdates?: Iterable<DateKey>;
};

export type ExpandedOccurrence = {
	/** The occurrence's date in the event's zone; identifies it within the series. */
	key: DateKey;
	/** Timed: UTC ms. All-day: unused (0). */
	startMs: number;
	endMs: number;
	/** All-day: first day and exclusive end day. */
	startDate: DateKey;
	endDate: DateKey;
};

function occurrenceAt(spec: SeriesSpec, date: DateKey): ExpandedOccurrence {
	if (spec.allDay) return { key: date, startMs: 0, endMs: 0, startDate: date, endDate: addDays(date, spec.duration) };
	const startMs = zonedToUtc(date, spec.startMinutes, spec.timeZone);
	return { key: date, startMs, endMs: startMs + spec.duration, startDate: date, endDate: date };
}

/**
 * Occurrences that overlap the window. Timed windows are UTC ms; all-day windows are
 * dates (exclusive end). Pass both so either kind can be tested.
 */
export function expandSeries(
	spec: SeriesSpec,
	window: { fromMs: number; toMs: number; fromDate: DateKey; toDate: DateKey },
	limit = 1000
): ExpandedOccurrence[] {
	const excluded = new Set(spec.exdates ?? []);
	const out: ExpandedOccurrence[] = [];
	const { rule } = spec;
	// Start a couple of periods before the window (plus the event's length) when no COUNT pins the numbering.
	const spanDays = spec.allDay ? spec.duration : Math.ceil(spec.duration / 86_400_000);
	const windowStart = spec.allDay ? window.fromDate : zonedParts(window.fromMs, spec.timeZone).date;
	const from = rule.count ? 0 : periodsBefore(rule, spec.startDate, addDays(windowStart, -spanDays - 1));
	let produced = 0;
	let steps = 0;
	for (const date of candidateDates(rule, spec.startDate, from)) {
		if (++steps > MAX_STEPS) break;
		if (rule.until && date > rule.until) break;
		if (rule.count && produced >= rule.count) break;
		produced++;
		const occurrence = occurrenceAt(spec, date);
		if (spec.allDay) {
			if (occurrence.startDate >= window.toDate) break;
			if (occurrence.endDate <= window.fromDate) continue;
		} else {
			if (occurrence.startMs >= window.toMs) break;
			if (occurrence.endMs <= window.fromMs) continue;
		}
		if (excluded.has(date)) continue;
		out.push(occurrence);
		if (out.length >= limit) break;
	}
	return out;
}

/** The final occurrence of a finite series, or null when it never ends (or is too long to walk). */
export function lastOccurrence(spec: SeriesSpec): ExpandedOccurrence | null {
	const { rule } = spec;
	if (!rule.count && !rule.until) return null;
	let last: DateKey | null = null;
	let produced = 0;
	let steps = 0;
	for (const date of candidateDates(rule, spec.startDate, 0)) {
		if (++steps > MAX_STEPS) return null;
		if (rule.until && date > rule.until) break;
		if (rule.count && produced >= rule.count) break;
		produced++;
		last = date;
	}
	return last ? occurrenceAt(spec, last) : null;
}

const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

function plural(n: number, unit: string): string {
	return n === 1 ? unit : `${n} ${unit}s`;
}

/** "Weekly on Mon, Wed", "Every 2 months on the last Friday, 10 times". */
export function describeRecurrence(rule: Recurrence, startDate: DateKey): string {
	const { month, day } = splitDateKey(startDate);
	let text: string;
	const every = (unit: string, adverb: string) => (rule.interval === 1 ? adverb : `Every ${plural(rule.interval, unit)}`);
	switch (rule.freq) {
		case 'DAILY':
			text = every('day', 'Daily');
			break;
		case 'WEEKLY': {
			const days = rule.byDay?.length ? rule.byDay : [weekday(startDate)];
			const weekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
			text = rule.interval === 1 && weekdays ? 'Every weekday' : `${every('week', 'Weekly')} on ${days.map((d) => weekdayName(d, 'short')).join(', ')}`;
			break;
		}
		case 'MONTHLY':
			text = `${every('month', 'Monthly')} on ${rule.byWeekdayOfMonth ? `the ${ORDINALS[rule.byWeekdayOfMonth.n]} ${weekdayName(rule.byWeekdayOfMonth.day)}` : `day ${day}`}`;
			break;
		case 'YEARLY':
			text = `${every('year', 'Annually')} on ${monthName(month)} ${day}`;
			break;
	}
	if (rule.count) text += rule.count === 1 ? ', once' : `, ${rule.count} times`;
	else if (rule.until) {
		const u = splitDateKey(rule.until);
		text += `, until ${monthName(u.month, true)} ${u.day}, ${u.year}`;
	}
	return text;
}

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly-day' | 'monthly-weekday' | 'yearly' | 'custom';

/** The quick choices offered for an event starting on `startDate`. */
export function repeatPresets(startDate: DateKey): { value: RepeatPreset; label: string; rule: Recurrence | null }[] {
	const wd = weekday(startDate);
	const position = weekdayOfMonth(startDate);
	const presets: { value: RepeatPreset; label: string; rule: Recurrence | null }[] = [
		{ value: 'none', label: 'Does not repeat', rule: null },
		{ value: 'daily', label: 'Daily', rule: { freq: 'DAILY', interval: 1 } },
		{ value: 'weekdays', label: 'Every weekday (Mon–Fri)', rule: { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] } },
		{ value: 'weekly', label: `Weekly on ${weekdayName(wd)}`, rule: { freq: 'WEEKLY', interval: 1, byDay: [wd] } },
		{ value: 'monthly-day', label: `Monthly on day ${splitDateKey(startDate).day}`, rule: { freq: 'MONTHLY', interval: 1 } }
	];
	if (position.n <= 4) {
		presets.push({ value: 'monthly-weekday', label: `Monthly on the ${ORDINALS[position.n]} ${weekdayName(wd)}`, rule: { freq: 'MONTHLY', interval: 1, byWeekdayOfMonth: { n: position.n, day: wd } } });
	} else if (position.last) {
		presets.push({ value: 'monthly-weekday', label: `Monthly on the last ${weekdayName(wd)}`, rule: { freq: 'MONTHLY', interval: 1, byWeekdayOfMonth: { n: -1, day: wd } } });
	}
	const { month, day } = splitDateKey(startDate);
	presets.push({ value: 'yearly', label: `Annually on ${monthName(month)} ${day}`, rule: { freq: 'YEARLY', interval: 1 } });
	return presets;
}

/** The preset that matches a rule exactly, or 'custom'. */
export function presetFor(rule: Recurrence | null, startDate: DateKey): RepeatPreset {
	if (!rule) return 'none';
	const formatted = formatRecurrence(rule);
	for (const preset of repeatPresets(startDate)) {
		if (preset.rule && formatRecurrence(preset.rule) === formatted) return preset.value;
	}
	return 'custom';
}

/** Keep a rule consistent when its first date moves (a weekly rule on the old weekday follows). */
export function retargetRecurrence(rule: Recurrence, oldStart: DateKey, newStart: DateKey): Recurrence {
	if (oldStart === newStart) return rule;
	const next: Recurrence = { ...rule };
	const shift = (weekday(newStart) - weekday(oldStart) + 7) % 7;
	if (rule.freq === 'WEEKLY' && rule.byDay?.length) next.byDay = [...new Set(rule.byDay.map((d) => (d + shift) % 7))].sort((a, b) => a - b);
	if (rule.freq === 'MONTHLY' && rule.byWeekdayOfMonth) {
		const position = weekdayOfMonth(newStart);
		const n = position.n > 4 || (rule.byWeekdayOfMonth.n === -1 && position.last) ? -1 : position.n;
		next.byWeekdayOfMonth = { n, day: position.day };
	}
	if (rule.until && rule.until < newStart) delete next.until;
	return next;
}

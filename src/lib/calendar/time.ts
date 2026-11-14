/**
 * Calendar date math without a date library. Days are plain `YYYY-MM-DD` keys and
 * wall-clock times are minutes after midnight in a named IANA time zone; instants
 * are UTC milliseconds. Everything that shows a time goes through a zone explicitly,
 * so the server render and the browser agree.
 */

export type DateKey = string;

export type ZonedParts = {
	date: DateKey;
	/** Minutes after local midnight, 0–1439. */
	minutes: number;
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	/** 0 = Sunday. */
	weekday: number;
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

export function isValidTimeZone(value: unknown): value is string {
	if (typeof value !== 'string' || !value || value.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export function isDateKey(value: unknown): value is DateKey {
	if (typeof value !== 'string') return false;
	const match = DATE_KEY.exec(value);
	if (!match) return false;
	const [, y, m, d] = match.map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function pad(value: number): string {
	return String(value).padStart(2, '0');
}

export function dateKey(year: number, month: number, day: number): DateKey {
	const date = new Date(Date.UTC(year, month - 1, day));
	return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function splitDateKey(key: DateKey): { year: number; month: number; day: number } {
	const [year, month, day] = key.split('-').map(Number);
	return { year, month, day };
}

export function addDays(key: DateKey, days: number): DateKey {
	const { year, month, day } = splitDateKey(key);
	return dateKey(year, month, day + days);
}

export function addMonths(key: DateKey, months: number): DateKey {
	const { year, month, day } = splitDateKey(key);
	// Clamp so Jan 31 + 1 month lands on the last day of February.
	const last = daysInMonth(year, month + months);
	return dateKey(year, month + months, Math.min(day, last));
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from `a` to `b`. */
export function diffDays(a: DateKey, b: DateKey): number {
	const pa = splitDateKey(a);
	const pb = splitDateKey(b);
	return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

/** 0 = Sunday. */
export function weekday(key: DateKey): number {
	const { year, month, day } = splitDateKey(key);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeek(key: DateKey, weekStartsOn = 0): DateKey {
	return addDays(key, -((weekday(key) - weekStartsOn + 7) % 7));
}

export function startOfMonth(key: DateKey): DateKey {
	const { year, month } = splitDateKey(key);
	return dateKey(year, month, 1);
}

export function zonedParts(instant: number, timeZone: string): ZonedParts {
	const values: Record<string, number> = {};
	for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
		if (part.type !== 'literal') values[part.type] = Number(part.value);
	}
	const hour = values.hour === 24 ? 0 : values.hour;
	const date = dateKey(values.year, values.month, values.day);
	return {
		date,
		minutes: hour * 60 + values.minute,
		year: values.year,
		month: values.month,
		day: values.day,
		hour,
		minute: values.minute,
		weekday: weekday(date)
	};
}

/** Offset of the zone from UTC at `instant`, in minutes (Toronto in winter: -300). */
export function zoneOffset(instant: number, timeZone: string): number {
	const p = zonedParts(instant, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
	const floored = Math.floor(instant / 60_000) * 60_000;
	return Math.round((asUtc - floored) / 60_000);
}

/**
 * The instant a wall-clock time happens in a zone. A time skipped by a DST jump
 * moves forward by the gap (2:30 on spring-forward day becomes 3:30); a repeated
 * time resolves to its first occurrence.
 */
export function zonedToUtc(date: DateKey, minutes: number, timeZone: string): number {
	const { year, month, day } = splitDateKey(date);
	const wall = Date.UTC(year, month - 1, day, 0, minutes);
	const first = wall - zoneOffset(wall, timeZone) * 60_000;
	const second = wall - zoneOffset(first, timeZone) * 60_000;
	if (first === second) return first;
	// Ambiguous or skipped: prefer the earlier reading that maps back to the wall time.
	const candidates = [first, second].sort((a, b) => a - b);
	for (const candidate of candidates) {
		const p = zonedParts(candidate, timeZone);
		if (p.date === date && p.minutes === minutes) return candidate;
	}
	return Math.max(first, second);
}

/** Midnight that starts `date` in the zone, as UTC ms. */
export function startOfDayUtc(date: DateKey, timeZone: string): number {
	return zonedToUtc(date, 0, timeZone);
}

export function todayKey(timeZone: string, now = Date.now()): DateKey {
	return zonedParts(now, timeZone).date;
}

export function minutesLabel(minutes: number, hour12 = true): string {
	const h = Math.floor(minutes / 60) % 24;
	const m = minutes % 60;
	if (!hour12) return `${pad(h)}:${pad(m)}`;
	const suffix = h < 12 ? 'am' : 'pm';
	const h12 = h % 12 || 12;
	return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`;
}

export function timeInputValue(minutes: number): string {
	return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

export function parseTimeInput(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	return h < 24 && m < 60 ? h * 60 + m : null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthName(month: number, short = false): string {
	const name = MONTHS[(month - 1 + 12) % 12];
	return short ? name.slice(0, 3) : name;
}

export function weekdayName(day: number, length: 'long' | 'short' | 'narrow' = 'long'): string {
	const name = WEEKDAYS[(day + 7) % 7];
	return length === 'long' ? name : length === 'short' ? name.slice(0, 3) : name[0];
}

/** "Sat, Nov 14" (year added when it is not `currentYear`). */
export function dayLabel(key: DateKey, currentYear?: number): string {
	const { year, month, day } = splitDateKey(key);
	const base = `${weekdayName(weekday(key), 'short')}, ${monthName(month, true)} ${day}`;
	return currentYear && year !== currentYear ? `${base}, ${year}` : base;
}

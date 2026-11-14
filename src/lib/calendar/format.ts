import { addDays, type DateKey } from './time';

type Timing = { allDay: boolean; start: string; end: string };

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	let found = cache.get(key);
	if (!found) {
		found = new Intl.DateTimeFormat('en-US', options);
		cache.set(key, found);
	}
	return found;
}

function dateText(date: DateKey, withYear = true): string {
	return formatter(`d${withYear}`, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${date}T12:00:00Z`));
}

function zonedDate(ms: number, zone: string, withYear = true): string {
	return formatter(`zd${zone}${withYear}`, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(ms));
}

export function zonedTime(ms: number, zone: string): string {
	return formatter(`t${zone}`, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

function zoneName(ms: number, zone: string): string {
	return formatter(`z${zone}`, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

/** "Mon, Nov 16, 2026 · 10:00 – 11:30 AM", "Thu, Nov 19 – Sat, Nov 21, 2026" and the like. */
export function formatEventWhen(event: Timing, zone: string, options: { withZone?: boolean } = {}): string {
	if (event.allDay) {
		const last = addDays(event.end, -1);
		if (last <= event.start) return dateText(event.start);
		return `${dateText(event.start, event.start.slice(0, 4) !== last.slice(0, 4))} – ${dateText(last)}`;
	}
	const start = Date.parse(event.start);
	const end = Date.parse(event.end);
	const suffix = options.withZone ? ` (${zoneName(start, zone)})` : '';
	const sameDay = zonedDate(start, zone) === zonedDate(end, zone);
	if (sameDay) {
		const from = zonedTime(start, zone);
		const to = zonedTime(end, zone);
		// "10:00 – 11:30 AM" when both share AM/PM.
		const shared = from.slice(-2) === to.slice(-2) && start !== end ? from.slice(0, -3) : from;
		return `${zonedDate(start, zone)} · ${start === end ? from : `${shared} – ${to}`}${suffix}`;
	}
	return `${zonedDate(start, zone, false)}, ${zonedTime(start, zone)} – ${zonedDate(end, zone)}, ${zonedTime(end, zone)}${suffix}`;
}

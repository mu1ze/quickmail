/** Pure layout for the calendar views: which days a view shows and where events sit. */
import {
	addDays,
	addMonths,
	diffDays,
	monthName,
	splitDateKey,
	startOfMonth,
	startOfWeek,
	zonedParts,
	type DateKey
} from './time';
import { CALENDAR_VIEWS, type CalendarOccurrence, type CalendarView } from './types';

export const WEEK_STARTS_ON = 0;
export const AGENDA_DAYS = 30;
export const SNAP_MINUTES = 15;
export const VIEW_COOKIE = 'qm_cal_view';
export const TZ_COOKIE = 'qm_tz';

export function readView(value: unknown, fallback: CalendarView = 'week'): CalendarView {
	return CALENDAR_VIEWS.includes(value as CalendarView) ? (value as CalendarView) : fallback;
}

/** The days a view covers: `from` inclusive, `to` exclusive. */
export function viewRange(view: CalendarView, date: DateKey): { from: DateKey; to: DateKey } {
	switch (view) {
		case 'day':
			return { from: date, to: addDays(date, 1) };
		case 'week': {
			const from = startOfWeek(date, WEEK_STARTS_ON);
			return { from, to: addDays(from, 7) };
		}
		case 'month': {
			const from = startOfWeek(startOfMonth(date), WEEK_STARTS_ON);
			return { from, to: addDays(from, 42) };
		}
		case 'agenda':
			return { from: date, to: addDays(date, AGENDA_DAYS) };
	}
}

export function stepDate(view: CalendarView, date: DateKey, direction: 1 | -1): DateKey {
	switch (view) {
		case 'day':
			return addDays(date, direction);
		case 'week':
			return addDays(date, 7 * direction);
		case 'month':
			return addMonths(startOfMonth(date), direction);
		case 'agenda':
			return addDays(date, AGENDA_DAYS * direction);
	}
}

export function daysBetween(from: DateKey, to: DateKey): DateKey[] {
	const days: DateKey[] = [];
	for (let day = from; day < to; day = addDays(day, 1)) days.push(day);
	return days;
}

/** "November 2026", "Nov 8 – 14, 2026", "Nov 29 – Dec 5, 2026", "Saturday, November 14, 2026". */
export function viewTitle(view: CalendarView, date: DateKey): string {
	const d = splitDateKey(date);
	if (view === 'month') return `${monthName(d.month)} ${d.year}`;
	if (view === 'day') return `${monthName(d.month)} ${d.day}, ${d.year}`;
	const { from, to } = viewRange(view, date);
	const a = splitDateKey(from);
	const b = splitDateKey(addDays(to, -1));
	if (a.year !== b.year) return `${monthName(a.month, true)} ${a.day}, ${a.year} – ${monthName(b.month, true)} ${b.day}, ${b.year}`;
	if (a.month !== b.month) return `${monthName(a.month, true)} ${a.day} – ${monthName(b.month, true)} ${b.day}, ${b.year}`;
	return `${monthName(a.month, true)} ${a.day} – ${b.day}, ${b.year}`;
}

/** Local span of an occurrence in the viewer's zone: start/end dates and minutes. */
export function localSpan(occurrence: CalendarOccurrence, timeZone: string): { startDate: DateKey; endDate: DateKey; startMinutes: number; endMinutes: number } {
	if (occurrence.allDay) return { startDate: occurrence.start, endDate: occurrence.end, startMinutes: 0, endMinutes: 0 };
	const start = zonedParts(Date.parse(occurrence.start), timeZone);
	const end = zonedParts(Date.parse(occurrence.end), timeZone);
	return { startDate: start.date, endDate: end.date, startMinutes: start.minutes, endMinutes: end.minutes };
}

/** All-day events, and timed events of a day or more, sit in the all-day lane. */
export function inAllDayLane(occurrence: CalendarOccurrence): boolean {
	return occurrence.allDay || Date.parse(occurrence.end) - Date.parse(occurrence.start) >= 86_400_000;
}

/** First and exclusive last day an occurrence covers, in the viewer's zone. */
export function coveredDays(occurrence: CalendarOccurrence, timeZone: string): { first: DateKey; last: DateKey } {
	const span = localSpan(occurrence, timeZone);
	if (occurrence.allDay) return { first: span.startDate, last: span.endDate };
	// A timed event ending exactly at midnight does not cover the next day.
	const last = span.endMinutes === 0 && span.endDate > span.startDate ? span.endDate : addDays(span.endDate, 1);
	return { first: span.startDate, last };
}

export type TimedBlock = {
	occurrence: CalendarOccurrence;
	/** Minutes after midnight on this day. */
	top: number;
	bottom: number;
	column: number;
	columns: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
};

const MIN_BLOCK = 20;

/** Timed events per day, packed side by side where they overlap. */
export function layoutTimedDay(occurrences: CalendarOccurrence[], day: DateKey, timeZone: string): TimedBlock[] {
	const blocks: TimedBlock[] = [];
	for (const occurrence of occurrences) {
		if (inAllDayLane(occurrence)) continue;
		const covered = coveredDays(occurrence, timeZone);
		if (covered.first > day || covered.last <= day) continue;
		const span = localSpan(occurrence, timeZone);
		const top = span.startDate === day ? span.startMinutes : 0;
		const bottom = span.endDate === day ? span.endMinutes : 1440;
		const continuesAfter = addDays(day, 1) < covered.last;
		blocks.push({ occurrence, top, bottom: Math.max(bottom, top + MIN_BLOCK), column: 0, columns: 1, continuesBefore: span.startDate < day, continuesAfter });
	}
	blocks.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
	// Clusters of transitively overlapping blocks share a column count.
	let cluster: TimedBlock[] = [];
	let clusterEnd = -1;
	const flush = () => {
		const ends: number[] = [];
		for (const block of cluster) {
			let column = ends.findIndex((end) => end <= block.top);
			if (column < 0) column = ends.length;
			ends[column] = block.bottom;
			block.column = column;
		}
		for (const block of cluster) block.columns = ends.length;
		cluster = [];
	};
	for (const block of blocks) {
		if (cluster.length && block.top >= clusterEnd) flush();
		cluster.push(block);
		clusterEnd = Math.max(clusterEnd, block.bottom);
	}
	flush();
	return blocks;
}

export type LaneBar = {
	occurrence: CalendarOccurrence;
	/** Index into the row's days. */
	start: number;
	span: number;
	row: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
};

/** Multi-day bars over a run of days (a week row), stacked into rows without overlap. */
export function layoutLane(occurrences: CalendarOccurrence[], days: DateKey[], timeZone: string, laneOnly = true): LaneBar[] {
	const first = days[0];
	const end = addDays(days[days.length - 1], 1);
	const bars: LaneBar[] = [];
	for (const occurrence of occurrences) {
		if (laneOnly && !inAllDayLane(occurrence)) continue;
		const covered = coveredDays(occurrence, timeZone);
		if (covered.first >= end || covered.last <= first) continue;
		const from = covered.first < first ? first : covered.first;
		const to = covered.last > end ? end : covered.last;
		bars.push({ occurrence, start: diffDays(first, from), span: Math.max(1, diffDays(from, to)), row: 0, continuesBefore: covered.first < first, continuesAfter: covered.last > end });
	}
	bars.sort((a, b) => a.start - b.start || b.span - a.span);
	const rows: number[] = [];
	for (const bar of bars) {
		let row = rows.findIndex((freeFrom) => freeFrom <= bar.start);
		if (row < 0) row = rows.length;
		rows[row] = bar.start + bar.span;
		bar.row = row;
	}
	return bars;
}

/** Occurrences touching a day, all-day first, then by start time. */
export function occurrencesOnDay(occurrences: CalendarOccurrence[], day: DateKey, timeZone: string): CalendarOccurrence[] {
	return occurrences.filter((occurrence) => {
		const covered = coveredDays(occurrence, timeZone);
		return covered.first <= day && covered.last > day;
	});
}

export function snap(minutes: number, step = SNAP_MINUTES): number {
	return Math.round(minutes / step) * step;
}

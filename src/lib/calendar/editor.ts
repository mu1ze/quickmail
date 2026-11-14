/** Form state for the event editor, converted to and from API events. */
import { localSpan } from './layout';
import { parseRecurrence, retargetRecurrence, formatRecurrence, type Recurrence } from './recurrence';
import { addDays, diffDays, parseTimeInput, timeInputValue, zonedToUtc, type DateKey } from './time';
import type { Attendee, CalendarOccurrence, EventInput } from './types';

export type EventDraft = {
	title: string;
	description: string;
	location: string;
	calendarId: string;
	allDay: boolean;
	startDate: DateKey;
	startTime: string;
	/** Inclusive for all-day events. */
	endDate: DateKey;
	endTime: string;
	rule: Recurrence | null;
	/** The zone the event repeats in (the creator's, for existing events). */
	timeZone: string;
	occurrence: CalendarOccurrence | null;
	/** Guests (the user's own events only). */
	attendees: Attendee[];
	/** Minutes before; see `reminderLabel`. */
	reminders: number[];
};

export function blankDraft(input: { date: DateKey; startMinutes?: number; endMinutes?: number; allDay?: boolean; calendarId: string; timeZone: string; endDate?: DateKey; defaultReminder?: number | null }): EventDraft {
	const start = input.startMinutes ?? 9 * 60;
	const end = input.endMinutes ?? Math.min(start + 60, 24 * 60);
	const endDate = input.endDate ?? (end >= 24 * 60 ? addDays(input.date, 1) : input.date);
	return {
		title: '',
		description: '',
		location: '',
		calendarId: input.calendarId,
		allDay: input.allDay ?? false,
		startDate: input.date,
		startTime: timeInputValue(start),
		endDate: input.allDay ? (input.endDate ?? input.date) : endDate,
		endTime: timeInputValue(end % (24 * 60)),
		rule: null,
		timeZone: input.timeZone,
		occurrence: null,
		attendees: [],
		reminders: !input.allDay && input.defaultReminder !== null && input.defaultReminder !== undefined ? [input.defaultReminder] : []
	};
}

export function draftFromOccurrence(occurrence: CalendarOccurrence, viewerZone: string): EventDraft {
	const span = localSpan(occurrence, viewerZone);
	return {
		title: occurrence.title,
		description: occurrence.description,
		location: occurrence.location,
		calendarId: occurrence.calendarId,
		allDay: occurrence.allDay,
		startDate: span.startDate,
		startTime: timeInputValue(occurrence.allDay ? 9 * 60 : span.startMinutes),
		endDate: occurrence.allDay ? addDays(span.endDate, -1) : span.endDate,
		endTime: timeInputValue(occurrence.allDay ? 10 * 60 : span.endMinutes),
		rule: occurrence.rrule ? parseRecurrence(occurrence.rrule) : null,
		timeZone: occurrence.timeZone,
		occurrence,
		attendees: occurrence.attendees.map((guest) => ({ ...guest })),
		reminders: [...occurrence.reminders]
	};
}

/** Builds the API event, or explains what is wrong with the form. */
export function draftToInput(draft: EventDraft, viewerZone: string): { ok: true; input: EventInput } | { ok: false; error: string } {
	const base = {
		calendarId: draft.calendarId,
		title: draft.title.trim(),
		description: draft.description,
		location: draft.location.trim(),
		timeZone: draft.timeZone,
		rrule: draft.rule ? formatRecurrence(draft.rule) : null,
		attendees: draft.attendees.map((guest) => ({ email: guest.email, name: guest.name })),
		reminders: draft.reminders
	};
	if (draft.allDay) {
		if (draft.endDate < draft.startDate) return { ok: false, error: 'The event must end on or after its start date.' };
		return { ok: true, input: { ...base, allDay: true, start: draft.startDate, end: addDays(draft.endDate, 1) } };
	}
	const startMinutes = parseTimeInput(draft.startTime);
	const endMinutes = parseTimeInput(draft.endTime);
	if (startMinutes === null || endMinutes === null) return { ok: false, error: 'Enter start and end times.' };
	const start = zonedToUtc(draft.startDate, startMinutes, viewerZone);
	const end = zonedToUtc(draft.endDate, endMinutes, viewerZone);
	if (end < start) return { ok: false, error: 'The event must end after it starts.' };
	return { ok: true, input: { ...base, allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString() } };
}

/** Moving the start keeps the length; a repeating rule follows the new weekday. */
export function moveDraftStart(draft: EventDraft, startDate: DateKey, startTime: string): EventDraft {
	const next = { ...draft, startDate, startTime };
	const oldStart = parseTimeInput(draft.startTime);
	const newStart = parseTimeInput(startTime);
	const oldEnd = parseTimeInput(draft.endTime);
	const dayShift = diffDays(draft.startDate, startDate);
	if (draft.allDay || oldStart === null || newStart === null || oldEnd === null) {
		next.endDate = addDays(draft.endDate, dayShift);
	} else {
		const length = diffDays(draft.startDate, draft.endDate) * 1440 + oldEnd - oldStart;
		const total = newStart + Math.max(0, length);
		next.endDate = addDays(startDate, Math.floor(total / 1440));
		next.endTime = timeInputValue(total % 1440);
	}
	if (draft.rule && dayShift) next.rule = retargetRecurrence(draft.rule, draft.startDate, startDate);
	return next;
}

/** Splits typed or pasted guests ("Sam <sam@x.com>, lee@y.org") into addresses. */
export function parseGuestInput(value: string): { email: string; name: string | null }[] {
	const out: { email: string; name: string | null }[] = [];
	for (const part of value.split(/[,;\n]+/)) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const angle = /^(.*?)<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);
		const email = (angle ? angle[2] : trimmed).trim().toLowerCase();
		if (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(email)) continue;
		const name = angle?.[1].trim().replace(/^"|"$/g, '') || null;
		if (!out.some((guest) => guest.email === email)) out.push({ email, name });
	}
	return out;
}

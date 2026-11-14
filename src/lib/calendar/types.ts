import type { DateKey } from './time';

export type CalendarInfo = {
	id: string;
	name: string;
	color: string;
	is_default: boolean;
	/** Subscribed (read-only) calendars: the feed they refresh from. */
	source_url: string | null;
	synced_at: string | null;
	sync_error: string | null;
};

export type AttendeeStatus = 'needs-action' | 'accepted' | 'tentative' | 'declined';

export type Attendee = { email: string; name: string | null; status: AttendeeStatus };

export type Organizer = { email: string; name: string | null };

/** One appearance of an event in the calendar (a single event, or one date of a series). */
export type CalendarOccurrence = {
	/** Unique per appearance: `${eventId}` or `${eventId}:${occurrenceKey}`. */
	id: string;
	eventId: string;
	calendarId: string;
	title: string;
	description: string;
	location: string;
	allDay: boolean;
	/** Timed: ISO instant. All-day: date. */
	start: string;
	/** Timed: ISO instant. All-day: exclusive end date. */
	end: string;
	timeZone: string;
	/** Present on repeating events. */
	rrule: string | null;
	/** The occurrence's date within its series (event zone); null for single events. */
	occurrenceKey: DateKey | null;
	/** Series start, so the editor can show and edit the whole series. */
	seriesStart: string;
	seriesEnd: string;
	/** Guests. On an invitation from someone else these are read-only. */
	attendees: Attendee[];
	organizer: Organizer | null;
	/** Set when someone else invited this user: their answer so far. */
	myStatus: AttendeeStatus | null;
	/** Minutes before the start (timed) or before 09:00 on the day (all-day). */
	reminders: number[];
};

export type EditScope = 'this' | 'following' | 'all';

/** The fields a client sends to create or change an event. */
export type EventInput = {
	calendarId: string;
	title: string;
	description: string;
	location: string;
	allDay: boolean;
	start: string;
	end: string;
	timeZone: string;
	rrule: string | null;
	/** Guests to invite (only on the user's own events). */
	attendees?: { email: string; name?: string | null }[];
	reminders?: number[];
};

export type CalendarSettings = {
	timeZone: string;
	/** Minutes before new timed events; null for none. */
	defaultReminder: number | null;
	agendaEmail: boolean;
	/** Local hour (0–23) the daily agenda arrives. */
	agendaHour: number;
	/** Private subscribe link, when turned on. */
	feedUrl: string | null;
};

export const MAX_REMINDERS = 5;
export const MAX_GUESTS = 100;

/** Reminder choices for timed events, in minutes before the start. */
export const TIMED_REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
/** All-day events: minutes before 09:00 on the day (0 = that morning). */
export const ALL_DAY_REMINDERS = [0, 1440, 2880, 10080];

export function reminderLabel(minutes: number, allDay: boolean): string {
	if (allDay) {
		if (minutes === 0) return 'On the day at 9am';
		const days = Math.round(minutes / 1440);
		return days === 7 ? '1 week before at 9am' : `${days} day${days === 1 ? '' : 's'} before at 9am`;
	}
	if (minutes === 0) return 'At the start';
	if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? '' : 's'} before`;
	if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`;
	if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`;
	return `${minutes} minutes before`;
}

export type CalendarView = 'month' | 'week' | 'day' | 'agenda';

export const CALENDAR_VIEWS: CalendarView[] = ['day', 'week', 'month', 'agenda'];

/** Swatches offered for calendars; each reads on light and dark surfaces. */
export const CALENDAR_COLORS = ['#3f7d5c', '#2f6fd6', '#7c4dce', '#c2417a', '#d1582c', '#b7861a', '#2a8b8b', '#5f6b7a'];

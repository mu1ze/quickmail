/**
 * Scheduled calendar work: reminders (every minute, as push and Brrr notifications)
 * and the optional daily agenda email (delivered straight into the inbox).
 */
import type { D1Database } from '@cloudflare/workers-types';
import { formatEventWhen, zonedTime } from '$lib/calendar/format';
import { expandSeries, parseRecurrence } from '$lib/calendar/recurrence';
import { addDays, monthName, weekdayName, zonedParts, zonedToUtc, splitDateKey, weekday, type DateKey } from '$lib/calendar/time';
import { EVENT_COLUMNS, listOccurrences, readExdates, readReminders, seriesSpec, type EventRow } from './calendar-store';
import { getDefaultAddress } from './domains';
import { insertEmail } from './mail-store';
import { deliverPushPayload, type PushNotificationEnv } from './push-notifications';
import { escapeHtml } from './send-mail';

/** A reminder that comes due while the scheduler was late still goes out within this. */
const CATCH_UP_MS = 10 * 60_000;
/** All-day reminders count back from 09:00 on the day. */
const ALL_DAY_BASE_MINUTES = 9 * 60;
const MAX_REMINDER_MS = 40_320 * 60_000;

export type DueReminder = { eventId: string; userId: string; occurrenceStart: number; fireAt: number; minutes: number; date: DateKey; row: EventRow };

/** The base instant reminders count back from: the start, or 09:00 for all-day events. */
function baseInstant(row: EventRow, date: DateKey, startMs: number | null): number {
	return row.all_day ? zonedToUtc(date, ALL_DAY_BASE_MINUTES, row.time_zone) : startMs!;
}

/** Reminders of one event that fall due in (now - catch-up, now]. */
export function dueReminders(row: EventRow, now: number): DueReminder[] {
	const reminders = readReminders(row);
	if (!reminders.length) return [];
	const longest = Math.max(...reminders) * 60_000;
	const out: DueReminder[] = [];
	const consider = (date: DateKey, startMs: number | null) => {
		const base = baseInstant(row, date, startMs);
		for (const minutes of reminders) {
			const fireAt = base - minutes * 60_000;
			if (fireAt <= now && fireAt > now - CATCH_UP_MS) out.push({ eventId: row.id, userId: row.user_id, occurrenceStart: base, fireAt, minutes, date, row });
		}
	};
	const rule = row.rrule ? parseRecurrence(row.rrule) : null;
	if (!rule) {
		const startMs = row.all_day ? null : Date.parse(row.start_at);
		const date = row.all_day ? row.start_at : zonedParts(startMs!, row.time_zone).date;
		consider(date, startMs);
		return out;
	}
	const fromMs = now - CATCH_UP_MS - 86_400_000;
	const toMs = now + longest + 2 * 86_400_000;
	const fromDate = zonedParts(fromMs, row.time_zone).date;
	const toDate = addDays(zonedParts(toMs, row.time_zone).date, 1);
	for (const occurrence of expandSeries(seriesSpec(row, rule, readExdates(row)), { fromMs, toMs, fromDate, toDate }, 400)) {
		consider(row.all_day ? occurrence.startDate : zonedParts(occurrence.startMs, row.time_zone).date, row.all_day ? null : occurrence.startMs);
	}
	return out;
}

function relative(ms: number, now: number, allDay: boolean, date: DateKey, zone: string): string {
	if (allDay) {
		const today = zonedParts(now, zone).date;
		if (date === today) return 'Today';
		if (date === addDays(today, 1)) return 'Tomorrow';
		const { month, day } = splitDateKey(date);
		return `${weekdayName(weekday(date), 'short')}, ${monthName(month, true)} ${day}`;
	}
	const minutes = Math.round((ms - now) / 60_000);
	if (minutes <= 0) return 'Now';
	if (minutes < 60) return `In ${minutes} minute${minutes === 1 ? '' : 's'}`;
	if (minutes < 1440) {
		const hours = Math.round(minutes / 60);
		return `In ${hours} hour${hours === 1 ? '' : 's'}`;
	}
	const days = Math.round(minutes / 1440);
	return `In ${days} day${days === 1 ? '' : 's'}`;
}

export function reminderText(reminder: DueReminder, viewerZone: string, now: number): { title: string; body: string } {
	const { row } = reminder;
	const when = row.all_day
		? relative(reminder.occurrenceStart, now, true, reminder.date, viewerZone)
		: `${relative(reminder.occurrenceStart, now, false, reminder.date, viewerZone)} · ${zonedTime(reminder.occurrenceStart, viewerZone)}`;
	return { title: row.title || '(No title)', body: row.location ? `${when} · ${row.location}` : when };
}

/** Finds reminders due now, records them so they are sent once, and sends them. */
export async function runCalendarReminders(env: PushNotificationEnv, now = Date.now()): Promise<number> {
	const db = env.DB;
	const upper = new Date(now + MAX_REMINDER_MS + 2 * 86_400_000).toISOString();
	const lower = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
	const { results } = await db
		.prepare(
			`SELECT ${EVENT_COLUMNS.split(', ').map((column) => `e.${column}`).join(', ')}, COALESCE(s.time_zone, e.time_zone) AS viewer_zone
			 FROM calendar_events e LEFT JOIN calendar_settings s ON s.user_id = e.user_id
			 WHERE e.reminders != '[]' AND (e.my_status IS NULL OR e.my_status != 'declined') AND e.start_at < ?
			   AND ((e.rrule IS NULL AND e.end_at >= ?) OR (e.rrule IS NOT NULL AND (e.recur_until IS NULL OR e.recur_until >= ?)))
			 LIMIT 5000`
		)
		.bind(upper, lower, lower)
		.all<EventRow & { viewer_zone: string }>();
	let sent = 0;
	for (const row of results) {
		for (const reminder of dueReminders(row, now)) {
			const claim = await db
				.prepare('INSERT OR IGNORE INTO calendar_reminders_sent(event_id, fire_at) VALUES (?, ?)')
				.bind(reminder.eventId, new Date(reminder.fireAt).toISOString())
				.run();
			if (!claim.meta.changes) continue;
			const text = reminderText(reminder, row.viewer_zone, now);
			await deliverPushPayload(
				env,
				{
					userId: row.user_id,
					title: text.title,
					body: text.body,
					tag: `quickmail-event-${row.id}-${reminder.date}`,
					url: `/calendar?view=day&date=${reminder.date}`
				},
				{ threadId: 'quickmail-calendar' }
			);
			sent++;
		}
	}
	if (new Date(now).getUTCMinutes() === 0) {
		await db.prepare(`DELETE FROM calendar_reminders_sent WHERE sent_at < datetime('now', '-3 days')`).run();
	}
	return sent;
}

// ---------------------------------------------------------------------------
// Daily agenda

function agendaHtml(title: string, items: { when: string; title: string; location: string }[]): string {
	const rows = items
		.map(
			(item) =>
				`<tr><td style="padding:6px 16px 6px 0;color:#555;white-space:nowrap;vertical-align:top">${escapeHtml(item.when)}</td><td style="padding:6px 0"><strong>${escapeHtml(item.title)}</strong>${item.location ? `<br><span style="color:#666">${escapeHtml(item.location)}</span>` : ''}</td></tr>`
		)
		.join('\n');
	return `<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>\n<table style="border-collapse:collapse;font-size:14px">\n${rows}\n</table>`;
}

/** Puts today's agenda in the inbox of users who asked for it, once a day at their hour. */
export async function runDailyAgenda(db: D1Database, now = Date.now()): Promise<number> {
	const { results } = await db
		.prepare('SELECT user_id, time_zone, agenda_hour, agenda_sent_on FROM calendar_settings WHERE agenda_email = 1 LIMIT 1000')
		.all<{ user_id: string; time_zone: string; agenda_hour: number; agenda_sent_on: string | null }>();
	let delivered = 0;
	for (const settings of results) {
		const local = zonedParts(now, settings.time_zone);
		// Within three hours of the chosen hour, so a missed run still delivers.
		if (local.hour < settings.agenda_hour || local.hour >= settings.agenda_hour + 3 || settings.agenda_sent_on === local.date) continue;
		const claim = await db
			.prepare('UPDATE calendar_settings SET agenda_sent_on = ? WHERE user_id = ? AND (agenda_sent_on IS NULL OR agenda_sent_on != ?)')
			.bind(local.date, settings.user_id, local.date)
			.run();
		if (!claim.meta.changes) continue;
		try {
			const occurrences = await listOccurrences(db, settings.user_id, { fromDate: local.date, toDate: addDays(local.date, 1), timeZone: settings.time_zone });
			if (!occurrences.length) continue;
			const address = await getDefaultAddress(db, settings.user_id);
			if (!address) continue;
			const { month, day } = splitDateKey(local.date);
			const subject = `Your agenda for ${weekdayName(weekday(local.date))}, ${monthName(month)} ${day}`;
			const items = occurrences.map((occurrence) => ({
				when: occurrence.allDay ? 'All day' : formatEventWhen(occurrence, settings.time_zone).split(' · ')[1] ?? '',
				title: occurrence.title || '(No title)',
				location: occurrence.location
			}));
			await insertEmail(db, {
				deduplicationId: `agenda-${settings.user_id}-${local.date}`,
				userId: settings.user_id,
				direction: 'inbound',
				from: address.address,
				fromName: 'QuickMail Calendar',
				to: address.address,
				subject,
				bodyText: [subject, '', ...items.map((item) => `${item.when}  ${item.title}${item.location ? ` (${item.location})` : ''}`)].join('\n'),
				bodyHtml: agendaHtml(subject, items),
				domainId: address.domain_id,
				providerId: `agenda-${settings.user_id}-${local.date}`
			});
			delivered++;
		} catch (error) {
			console.error('daily agenda failed', error instanceof Error ? error.message : error);
		}
	}
	return delivered;
}

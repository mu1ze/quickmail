/**
 * Invitations by email, in both directions.
 *
 * Sending: when the user saves or deletes an event with guests, each guest gets an
 * email with an invite.ics (METHOD:REQUEST or CANCEL). Answers come back as
 * METHOD:REPLY mail and update the guest's status.
 *
 * Receiving: an invitation in the inbox shows as a card; answering it adds the event
 * (or records the decline) and mails a METHOD:REPLY to the organizer. Updates and
 * cancellations from the organizer are applied as they arrive.
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow, MailAddress, User } from '$lib/types';
import { formatEventWhen } from '$lib/calendar/format';
import {
	buildICalendar,
	occurrenceDate,
	parseICalendar,
	partstatToStatus,
	resolveTimes,
	type ICalEvent,
	type ICalendar,
	type OutEvent
} from '$lib/calendar/ical';
import { describeRecurrence, parseRecurrence } from '$lib/calendar/recurrence';
import { zonedParts } from '$lib/calendar/time';
import type { Attendee, AttendeeStatus, Organizer } from '$lib/calendar/types';
import { readAttachmentBytes } from './attachments';
import {
	EVENT_COLUMNS,
	insertStatement,
	listCalendars,
	readAttendees,
	readExdates,
	readOrganizer,
	readReminders,
	readStatus,
	writableCalendarIds,
	type EventRow
} from './calendar-store';
import { groupToOutEvents, prepareGroup } from './calendar-ics';
import { getCalendarSettings } from './calendar-settings';
import { listAddressesForUser } from './domains';
import type { EmailProvider } from './email-provider';
import { parseEmailAddress } from './email-address';
import { escapeHtml } from './send-mail';
import { resolveFromAddress, resolveReplyFromAddress, sendAndStore } from './outbox';
import { buildReferences } from './threads';

export type InviteEnv = { DB: D1Database; ATTACHMENTS: R2Bucket };
export type InviteContext = { env: InviteEnv; provider: EmailProvider; user: User; origin: string };

const MAX_INVITE_BYTES = 1024 * 1024;

export async function loadGroup(db: D1Database, userId: string, uid: string): Promise<EventRow[]> {
	const { results } = await db
		.prepare(`SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE user_id = ? AND ical_uid = ? ORDER BY recurrence_id IS NOT NULL, recurrence_id LIMIT 500`)
		.bind(userId, uid)
		.all<EventRow>();
	return results;
}

function base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

function isInvited(rows: EventRow[]): boolean {
	return rows.some((row) => row.my_email);
}

function guestsOf(rows: EventRow[]): Attendee[] {
	const seen = new Map<string, Attendee>();
	for (const row of rows) for (const guest of readAttendees(row)) if (!seen.has(guest.email)) seen.set(guest.email, guest);
	return [...seen.values()];
}

/** What a guest sees. A change here means the invitation is sent again. */
function contentKey(rows: EventRow[]): string {
	return JSON.stringify(
		rows.map((row) => [row.recurrence_id, row.title, row.description, row.location, row.all_day, row.start_at, row.end_at, row.time_zone, row.rrule, readExdates(row)])
	);
}

function timeKey(rows: EventRow[]): string {
	return JSON.stringify(rows.map((row) => [row.recurrence_id, row.all_day, row.start_at, row.end_at, row.time_zone, row.rrule, readExdates(row)]));
}

async function organizerIdentity(db: D1Database, user: User, rows: EventRow[]): Promise<MailAddress> {
	const stored = rows.map(readOrganizer).find(Boolean);
	if (stored) {
		const owned = (await listAddressesForUser(db, user.id)).find((address) => address.address.toLowerCase() === stored.email.toLowerCase());
		if (owned) return owned;
	}
	return resolveFromAddress(db, user, null);
}

function inviteBody(kind: 'new' | 'update' | 'cancel', event: EventRow, organizer: Organizer, guests: Attendee[]): { text: string; html: string } {
	const when = formatEventWhen({ allDay: Boolean(event.all_day), start: event.start_at, end: event.end_at }, event.time_zone, { withZone: !event.all_day });
	const repeat = event.rrule ? describeRepeat(event) : null;
	const lead =
		kind === 'cancel'
			? `${organizer.name ?? organizer.email} canceled this event.`
			: kind === 'update'
				? `${organizer.name ?? organizer.email} updated this event.`
				: `${organizer.name ?? organizer.email} invited you to this event.`;
	const lines = [lead, '', event.title || '(No title)', when];
	if (repeat) lines.push(repeat);
	if (event.location) lines.push(`Where: ${event.location}`);
	if (guests.length) lines.push(`Guests: ${guests.map((guest) => guest.name ?? guest.email).join(', ')}`);
	if (event.description) lines.push('', event.description);
	if (kind !== 'cancel') lines.push('', 'Open the attached invitation to answer.');
	const row = (label: string, value: string) => `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${label}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`;
	const html = [
		`<p>${escapeHtml(lead)}</p>`,
		`<h2 style="margin:12px 0 8px;font-size:18px${kind === 'cancel' ? ';text-decoration:line-through' : ''}">${escapeHtml(event.title || '(No title)')}</h2>`,
		'<table style="border-collapse:collapse;font-size:14px">',
		row('When', when),
		repeat ? row('Repeats', repeat) : '',
		event.location ? row('Where', event.location) : '',
		guests.length ? row('Guests', guests.map((guest) => guest.name ?? guest.email).join(', ')) : '',
		'</table>',
		event.description ? `<p style="white-space:pre-wrap;margin-top:12px">${escapeHtml(event.description)}</p>` : '',
		kind !== 'cancel' ? '<p style="color:#666;font-size:13px;margin-top:16px">Open the attached invitation to answer.</p>' : ''
	].join('\n');
	return { text: lines.join('\n'), html };
}

function describeRepeat(event: EventRow): string | null {
	const rule = event.rrule ? parseRecurrence(event.rrule) : null;
	if (!rule) return null;
	const startDate = event.all_day ? event.start_at : zonedParts(Date.parse(event.start_at), event.time_zone).date;
	return describeRecurrence(rule, startDate);
}

async function sendCalendarMail(
	ctx: InviteContext,
	input: { from: MailAddress; to: string[]; subject: string; text: string; html: string; ics: string; inReplyTo?: string | null; references?: string | null; replyToEmailId?: string | null }
): Promise<void> {
	await sendAndStore(ctx.env, ctx.provider, ctx.user, {
		fromAddress: input.from,
		to: input.to.join(', '),
		subject: input.subject.slice(0, 200),
		text: input.text,
		html: input.html,
		includeSignature: false,
		inReplyTo: input.inReplyTo ?? null,
		references: input.references ?? null,
		replyToEmailId: input.replyToEmailId ?? null,
		attachments: [{ filename: 'invite.ics', type: 'text/calendar', content: base64(input.ics), disposition: 'attachment' }]
	});
}

function subjectWhen(row: EventRow): string {
	return formatEventWhen({ allDay: Boolean(row.all_day), start: row.start_at, end: row.end_at }, row.time_zone, { withZone: !row.all_day });
}

/**
 * Emails guests about a change to one of the user's own events. `before` and `after`
 * are the rows sharing one UID before and after the change. Returns warnings; mail
 * problems never undo the calendar change.
 */
export async function notifyGuests(ctx: InviteContext, uid: string, before: EventRow[], after: EventRow[]): Promise<string[]> {
	if (isInvited(before) || isInvited(after)) return [];
	const db = ctx.env.DB;
	const guestsBefore = guestsOf(before);
	const guestsAfter = guestsOf(after);
	if (!guestsBefore.length && !guestsAfter.length) return [];
	const warnings: string[] = [];
	const rows = after.length ? after : before;
	let from: MailAddress;
	try {
		from = await organizerIdentity(db, ctx.user, rows);
	} catch (error) {
		return [`Guests were not emailed: ${error instanceof Error ? error.message : 'no sending address'}`];
	}
	const organizer: Organizer = { email: from.address, name: from.label?.trim() || ctx.user.name || null };
	const master = rows.find((row) => !row.recurrence_id) ?? rows[0];
	const nextSequence = Math.max(0, ...rows.map((row) => row.sequence)) + 1;

	const cancel = async (guests: Attendee[], label: string) => {
		if (!guests.length) return;
		const events: OutEvent[] = groupToOutEvents(before.length ? before : after, true).map((event) => ({
			...event,
			sequence: nextSequence,
			status: 'CANCELLED',
			organizer,
			attendees: guests.map((guest) => ({ ...guest, rsvp: false }))
		}));
		const body = inviteBody('cancel', master, organizer, []);
		try {
			await sendCalendarMail(ctx, { from, to: guests.map((guest) => guest.email), subject: `${label}: ${master.title || '(No title)'} @ ${subjectWhen(master)}`, ...body, ics: buildICalendar({ method: 'CANCEL', events }) });
		} catch (error) {
			warnings.push(`The cancellation could not be emailed: ${error instanceof Error ? error.message : 'send failed'}`);
		}
	};

	if (!after.length) {
		await cancel(guestsBefore, 'Canceled');
		return warnings;
	}

	const afterEmails = new Set(guestsAfter.map((guest) => guest.email));
	const beforeEmails = new Set(guestsBefore.map((guest) => guest.email));
	await cancel(guestsBefore.filter((guest) => !afterEmails.has(guest.email)), 'Canceled');
	if (!guestsAfter.length) return warnings;

	const added = guestsAfter.filter((guest) => !beforeEmails.has(guest.email));
	const changed = !before.length || contentKey(before) !== contentKey(after);
	if (!changed && !added.length) return warnings;

	const statements = [];
	const retimed = before.length > 0 && timeKey(before) !== timeKey(after);
	for (const row of after) {
		// A new time needs a new answer from everyone.
		const attendees = retimed ? readAttendees(row).map((guest) => ({ ...guest, status: 'needs-action' as AttendeeStatus })) : readAttendees(row);
		statements.push(
			db
				.prepare('UPDATE calendar_events SET organizer = ?, attendees = ?, sequence = ? WHERE id = ? AND user_id = ?')
				.bind(JSON.stringify(organizer), JSON.stringify(attendees), changed ? nextSequence : row.sequence, row.id, row.user_id)
		);
	}
	await db.batch(statements);
	const fresh = await loadGroup(db, ctx.user.id, uid);
	const recipients = changed ? guestsAfter : added;
	const freshMaster = fresh.find((row) => !row.recurrence_id) ?? fresh[0] ?? master;
	const body = inviteBody(before.length && changed ? 'update' : 'new', freshMaster, organizer, guestsOf(fresh));
	const label = before.length && changed ? 'Updated invitation' : 'Invitation';
	try {
		await sendCalendarMail(ctx, {
			from,
			to: recipients.map((guest) => guest.email),
			subject: `${label}: ${freshMaster.title || '(No title)'} @ ${subjectWhen(freshMaster)}`,
			...body,
			ics: buildICalendar({ method: 'REQUEST', events: groupToOutEvents(fresh, true).map((event) => ({ ...event, organizer })) })
		});
	} catch (error) {
		warnings.push(`Guests were not emailed: ${error instanceof Error ? error.message : 'send failed'}`);
	}
	return warnings;
}

// ---------------------------------------------------------------------------
// Receiving

type AttachmentRow = { id: string; email_id: string; filename: string; content_type: string; size_bytes: number; storage_key: string | null; content_base64: string | null; created_at: string };

/** The calendar file attached to an email, parsed. Prefers the text/calendar part. */
export async function readInviteFile(env: InviteEnv, userId: string, emailId: string): Promise<ICalendar | null> {
	const { results } = await env.DB
		.prepare(
			`SELECT a.id, a.email_id, a.filename, a.content_type, a.size_bytes, a.storage_key, a.content_base64, a.created_at
			 FROM email_attachments a JOIN emails e ON e.id = a.email_id
			 WHERE a.email_id = ? AND e.user_id = ? AND a.size_bytes <= ?
			   AND (lower(a.content_type) LIKE 'text/calendar%' OR lower(a.content_type) LIKE 'application/ics%' OR lower(a.filename) LIKE '%.ics')
			 ORDER BY lower(a.content_type) LIKE 'text/calendar%' DESC, a.created_at LIMIT 2`
		)
		.bind(emailId, userId, MAX_INVITE_BYTES)
		.all<AttachmentRow>();
	for (const row of results) {
		try {
			const bytes = await readAttachmentBytes(env.ATTACHMENTS, row);
			if (!bytes) continue;
			const calendar = parseICalendar(new TextDecoder().decode(bytes));
			if (calendar.events.length) return calendar;
		} catch {
			/* try the next file */
		}
	}
	return null;
}

export function hasCalendarAttachment(attachments: { content_type: string; filename: string }[]): boolean {
	return attachments.some((file) => /^(text\/calendar|application\/ics)/i.test(file.content_type) || /\.ics$/i.test(file.filename));
}

async function emailRow(db: D1Database, userId: string, emailId: string): Promise<EmailRow | null> {
	return db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').bind(emailId, userId).first<EmailRow>();
}

/** The user's address among the invitation's guests (or the mailbox that received it). */
async function myAddress(db: D1Database, userId: string, email: EmailRow, event: ICalEvent): Promise<string> {
	const owned = new Set((await listAddressesForUser(db, userId)).map((address) => address.address.toLowerCase()));
	const listed = event.attendees.find((person) => owned.has(person.email));
	return listed?.email ?? parseEmailAddress(email.to_addr).toLowerCase();
}

export type InviteView = {
	method: string;
	uid: string;
	title: string;
	location: string;
	description: string;
	allDay: boolean;
	start: string;
	end: string;
	timeZone: string;
	repeat: string | null;
	/** The sender's repeat rule could not be kept; only the first date is added. */
	repeatSimplified: boolean;
	organizer: Organizer | null;
	attendees: Attendee[];
	attendeeCount: number;
	myEmail: string;
	myStatus: AttendeeStatus | null;
	eventId: string | null;
	calendarId: string | null;
	/** The user organizes this event (a guest's reply, or their own sent invite). */
	mine: boolean;
	/** A later version of this invitation has already been applied. */
	outdated: boolean;
	/** REPLY mail: the guest who answered, and how. */
	reply: { email: string; name: string | null; status: AttendeeStatus } | null;
	canceled: boolean;
};

export async function describeInvite(env: InviteEnv, user: User, emailId: string): Promise<InviteView | null> {
	const email = await emailRow(env.DB, user.id, emailId);
	if (!email) return null;
	const calendar = await readInviteFile(env, user.id, emailId);
	if (!calendar) return null;
	const event = calendar.events.find((item) => !item.recurrenceId) ?? calendar.events[0];
	const settings = await getCalendarSettings(env.DB, user.id);
	const times = resolveTimes(event, settings.timeZone, calendar.zones);
	const rows = await loadGroup(env.DB, user.id, event.uid);
	const invitedRows = rows.filter((row) => row.my_email);
	const ownRows = rows.filter((row) => !row.my_email);
	const stored = invitedRows.find((row) => !row.recurrence_id) ?? invitedRows[0] ?? null;
	const prepared = prepareGroup(calendar.events.filter((item) => item.uid === event.uid), calendar, 'preview', settings.timeZone);
	const rule = prepared.rows[0]?.event.rule ?? null;
	const method = calendar.method ?? 'PUBLISH';
	const replier = method === 'REPLY' ? event.attendees.find((person) => person.email === parseEmailAddress(email.from_addr).toLowerCase()) ?? event.attendees[0] : null;
	const me = await myAddress(env.DB, user.id, email, event);
	const attendees = event.attendees.map((person) => ({ email: person.email, name: person.name, status: partstatToStatus(person.partstat) }));
	return {
		method,
		uid: event.uid,
		title: event.summary || '(No title)',
		location: event.location,
		description: event.description.slice(0, 2000),
		allDay: times.allDay,
		start: times.start,
		end: times.end,
		timeZone: times.timeZone,
		repeat: rule ? describeRecurrence(rule, times.startDate) : null,
		repeatSimplified: prepared.simplified,
		organizer: event.organizer ? { email: event.organizer.email, name: event.organizer.name } : null,
		attendees: attendees.slice(0, 30),
		attendeeCount: attendees.length,
		myEmail: me,
		myStatus: stored ? readStatus(stored.my_status) ?? 'needs-action' : null,
		eventId: (stored ?? ownRows[0])?.id ?? null,
		calendarId: (stored ?? ownRows[0])?.calendar_id ?? null,
		mine: ownRows.length > 0 && !stored,
		outdated: Boolean(stored && event.sequence < stored.sequence),
		reply: replier ? { email: replier.email, name: replier.name, status: partstatToStatus(replier.partstat) } : null,
		canceled: method === 'CANCEL' || event.status === 'CANCELLED'
	};
}

/**
 * Writes an invitation's events into the calendar. A file with the whole series
 * replaces what is stored; a file with single dates only replaces those dates.
 * The user's calendar, reminders and answer are kept.
 */
async function storeInvitation(
	db: D1Database,
	userId: string,
	calendar: ICalendar,
	uid: string,
	options: { calendarId: string; reminders: number[]; myEmail: string; myStatus: AttendeeStatus; zone: string; existing: EventRow[] }
): Promise<string | null> {
	const events = calendar.events.filter((event) => event.uid === uid);
	const master = events.find((event) => !event.recurrenceId);
	const prepared = prepareGroup(events, calendar, options.calendarId, options.zone);
	const statements = [];
	const organizer = master?.organizer ?? events[0]?.organizer ?? null;
	const peopleFor = (event: ICalEvent) =>
		event.attendees.map((person) => ({
			email: person.email,
			name: person.name,
			status: person.email === options.myEmail ? options.myStatus : partstatToStatus(person.partstat)
		}));
	if (master) {
		statements.push(db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL').bind(userId, uid));
	} else {
		const seriesRow = options.existing.find((row) => !row.recurrence_id);
		for (const row of prepared.rows) {
			statements.push(db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL AND recurrence_id = ?').bind(userId, uid, row.recurrenceId));
		}
		if (seriesRow) {
			const exdates = [...new Set([...readExdates(seriesRow), ...events.map((event) => occurrenceDate(event.recurrenceId!, resolveTimes(event, seriesRow.time_zone, calendar.zones), calendar.zones))])];
			statements.push(db.prepare('UPDATE calendar_events SET exdates = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(exdates), seriesRow.id, userId));
		}
	}
	const ids: string[] = [];
	prepared.rows.forEach((row, index) => {
		const source = master && index === 0 ? master : events.find((event) => event.recurrenceId && occurrenceDate(event.recurrenceId, resolveTimes(event, options.zone, calendar.zones), calendar.zones) === row.recurrenceId) ?? events[0];
		const id = crypto.randomUUID();
		ids.push(id);
		statements.push(
			insertStatement(db, userId, id, { ...row.event, reminders: options.reminders }, row.exdates, {
				icalUid: uid,
				recurrenceId: master ? row.recurrenceId : (row.recurrenceId ?? null),
				sequence: row.sequence,
				organizer: organizer ? { email: organizer.email, name: organizer.name } : null,
				attendees: peopleFor(source),
				myEmail: options.myEmail,
				myStatus: options.myStatus
			})
		);
	});
	if (statements.length) await db.batch(statements);
	return ids[0] ?? null;
}

const STATUS_WORD: Record<AttendeeStatus, string> = { accepted: 'Accepted', tentative: 'Tentative', declined: 'Declined', 'needs-action': 'Invited' };
const STATUS_SENTENCE: Record<AttendeeStatus, string> = { accepted: 'has accepted', tentative: 'might attend', declined: 'has declined', 'needs-action': 'has not answered' };

/** Answers an invitation in the inbox: stores the event and replies to the organizer. */
export async function respondToInvite(
	ctx: InviteContext,
	emailId: string,
	status: Exclude<AttendeeStatus, 'needs-action'>,
	calendarId?: string | null
): Promise<{ ok: true; eventId: string | null; warnings: string[] } | { ok: false; error: string; status: number }> {
	const db = ctx.env.DB;
	const email = await emailRow(db, ctx.user.id, emailId);
	if (!email) return { ok: false, error: 'Email not found', status: 404 };
	const calendar = await readInviteFile(ctx.env, ctx.user.id, emailId);
	if (!calendar) return { ok: false, error: 'This email has no invitation.', status: 400 };
	const method = calendar.method ?? 'PUBLISH';
	if (method !== 'REQUEST' && method !== 'PUBLISH') return { ok: false, error: 'This invitation cannot be answered.', status: 400 };
	const event = calendar.events.find((item) => !item.recurrenceId) ?? calendar.events[0];
	if (event.status === 'CANCELLED') return { ok: false, error: 'This event was canceled.', status: 400 };

	const calendars = await listCalendars(db, ctx.user.id);
	const writable = writableCalendarIds(calendars);
	const existing = (await loadGroup(db, ctx.user.id, event.uid)).filter((row) => row.my_email);
	if (!existing.length && (await loadGroup(db, ctx.user.id, event.uid)).length) return { ok: false, error: 'This is your own event.', status: 400 };
	const target = calendarId && writable.includes(calendarId) ? calendarId : (existing[0]?.calendar_id ?? writable[0]);
	if (!target) return { ok: false, error: 'Create a calendar first.', status: 400 };
	const settings = await getCalendarSettings(db, ctx.user.id);
	const me = await myAddress(db, ctx.user.id, email, event);
	const allDay = event.start.minutes === null;
	const reminders = existing.length ? readReminders(existing[0]) : !allDay && settings.defaultReminder !== null ? [settings.defaultReminder] : [];
	const eventId = await storeInvitation(db, ctx.user.id, calendar, event.uid, {
		calendarId: target,
		reminders,
		myEmail: me,
		myStatus: status,
		zone: settings.timeZone,
		existing
	});

	const warnings: string[] = [];
	if (method === 'REQUEST' && event.organizer) {
		try {
			const from = await resolveReplyFromAddress(db, ctx.user, email);
			if (!from) throw new Error('No sending address configured.');
			const times = resolveTimes(event, settings.timeZone, calendar.zones);
			const myName = event.attendees.find((person) => person.email === me)?.name ?? ctx.user.name ?? null;
			const ics = buildICalendar({
				method: 'REPLY',
				events: [
					{
						uid: event.uid,
						sequence: event.sequence,
						title: event.summary,
						allDay: times.allDay,
						start: times.start,
						end: times.end,
						timeZone: times.timeZone,
						organizer: { email: event.organizer.email, name: event.organizer.name },
						attendees: [{ email: me, name: myName, status }]
					}
				]
			});
			const when = formatEventWhen(times, times.timeZone, { withZone: !times.allDay });
			const who = myName ?? me;
			await sendCalendarMail(ctx, {
				from,
				to: [event.organizer.email],
				subject: `${STATUS_WORD[status]}: ${event.summary || '(No title)'} @ ${when}`,
				text: `${who} ${STATUS_SENTENCE[status]} this invitation.`,
				html: `<p>${escapeHtml(who)} ${STATUS_SENTENCE[status]} this invitation.</p>`,
				ics,
				inReplyTo: email.message_id,
				references: buildReferences(email.references_header, email.message_id),
				replyToEmailId: email.id
			});
		} catch (error) {
			warnings.push(`Your answer was saved, but the organizer was not emailed: ${error instanceof Error ? error.message : 'send failed'}`);
		}
	}
	return { ok: true, eventId: status === 'declined' ? null : eventId, warnings };
}

/**
 * Applies calendar mail as it arrives: organizer updates and cancellations to
 * invitations the user answered, and guests' answers to the user's own events.
 * New invitations wait for the user to answer them. Never throws.
 */
export async function applyCalendarMail(env: InviteEnv, userId: string, emailId: string): Promise<void> {
	try {
		const email = await emailRow(env.DB, userId, emailId);
		if (!email || email.direction !== 'inbound') return;
		const calendar = await readInviteFile(env, userId, emailId);
		if (!calendar?.events.length) return;
		const method = calendar.method ?? 'PUBLISH';
		const sender = parseEmailAddress(email.from_addr).toLowerCase();
		for (const uid of new Set(calendar.events.map((event) => event.uid))) {
			const events = calendar.events.filter((event) => event.uid === uid);
			const rows = await loadGroup(env.DB, userId, uid);
			if (method === 'REPLY') {
				await applyReply(env.DB, rows.filter((row) => !row.my_email), events, sender);
				continue;
			}
			const invited = rows.filter((row) => row.my_email);
			if (!invited.length) continue;
			const storedOrganizer = invited.map(readOrganizer).find(Boolean);
			const organizer = events.find((event) => event.organizer)?.organizer;
			if (storedOrganizer && organizer && storedOrganizer.email.toLowerCase() !== organizer.email) continue;
			const master = invited.find((row) => !row.recurrence_id) ?? invited[0];
			if (method === 'CANCEL') {
				await applyCancel(env.DB, userId, invited, events, calendar);
				continue;
			}
			if (method !== 'REQUEST') continue;
			const sequence = Math.max(...events.map((event) => event.sequence));
			if (sequence < master.sequence) continue;
			const settings = await getCalendarSettings(env.DB, userId);
			await storeInvitation(env.DB, userId, calendar, uid, {
				calendarId: master.calendar_id,
				reminders: readReminders(master),
				myEmail: master.my_email!,
				myStatus: readStatus(master.my_status) ?? 'needs-action',
				zone: settings.timeZone,
				existing: invited
			});
		}
	} catch (error) {
		console.error('calendar mail could not be applied', error instanceof Error ? error.message : error);
	}
}

async function applyReply(db: D1Database, rows: EventRow[], events: ICalEvent[], sender: string): Promise<void> {
	if (!rows.length) return;
	const answer = events.flatMap((event) => event.attendees).find((person) => person.email === sender);
	if (!answer) return;
	const status = partstatToStatus(answer.partstat);
	const statements = [];
	for (const row of rows) {
		const guests = readAttendees(row);
		if (!guests.some((guest) => guest.email === sender)) continue;
		const next = guests.map((guest) => (guest.email === sender ? { ...guest, status, name: guest.name ?? answer.name } : guest));
		statements.push(db.prepare('UPDATE calendar_events SET attendees = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(next), row.id, row.user_id));
	}
	if (statements.length) await db.batch(statements);
}

async function applyCancel(db: D1Database, userId: string, rows: EventRow[], events: ICalEvent[], calendar: ICalendar): Promise<void> {
	const whole = events.some((event) => !event.recurrenceId);
	if (whole) {
		await db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL').bind(userId, rows[0].ical_uid).run();
		return;
	}
	const series = rows.find((row) => !row.recurrence_id);
	const statements = [];
	const dates = events.map((event) => occurrenceDate(event.recurrenceId!, resolveTimes(event, series?.time_zone ?? 'UTC', calendar.zones), calendar.zones));
	for (const date of dates) {
		statements.push(db.prepare('DELETE FROM calendar_events WHERE user_id = ? AND ical_uid = ? AND my_email IS NOT NULL AND recurrence_id = ?').bind(userId, rows[0].ical_uid, date));
	}
	if (series) {
		statements.push(db.prepare('UPDATE calendar_events SET exdates = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify([...new Set([...readExdates(series), ...dates])]), series.id, userId));
	}
	if (statements.length) await db.batch(statements);
}

/** Changes the answer to an invitation from the calendar (not from its email). */
export async function respondToEvent(
	ctx: InviteContext,
	row: EventRow,
	status: Exclude<AttendeeStatus, 'needs-action'>
): Promise<{ ok: true; warnings: string[] } | { ok: false; error: string; status: number }> {
	const db = ctx.env.DB;
	if (!row.my_email || !row.ical_uid) return { ok: false, error: 'This is not an invitation.', status: 400 };
	const rows = (await loadGroup(db, ctx.user.id, row.ical_uid)).filter((item) => item.my_email);
	const statements = rows.map((item) =>
		db
			.prepare('UPDATE calendar_events SET my_status = ?, attendees = ? WHERE id = ? AND user_id = ?')
			.bind(status, JSON.stringify(readAttendees(item).map((guest) => (guest.email === item.my_email ? { ...guest, status } : guest))), item.id, item.user_id)
	);
	if (statements.length) await db.batch(statements);
	const organizer = readOrganizer(row);
	if (!organizer) return { ok: true, warnings: [] };
	const master = rows.find((item) => !item.recurrence_id) ?? row;
	try {
		const owned = (await listAddressesForUser(db, ctx.user.id)).find((address) => address.address.toLowerCase() === row.my_email);
		const from = owned ?? (await resolveFromAddress(db, ctx.user, null));
		const me = readAttendees(master).find((guest) => guest.email === row.my_email);
		const ics = buildICalendar({
			method: 'REPLY',
			events: [
				{
					uid: row.ical_uid,
					sequence: master.sequence,
					title: master.title,
					allDay: Boolean(master.all_day),
					start: master.start_at,
					end: master.end_at,
					timeZone: master.time_zone,
					organizer,
					attendees: [{ email: row.my_email, name: me?.name ?? ctx.user.name ?? null, status }]
				}
			]
		});
		const who = me?.name ?? ctx.user.name ?? row.my_email;
		await sendCalendarMail(ctx, {
			from,
			to: [organizer.email],
			subject: `${STATUS_WORD[status]}: ${master.title || '(No title)'} @ ${subjectWhen(master)}`,
			text: `${who} ${STATUS_SENTENCE[status]} this invitation.`,
			html: `<p>${escapeHtml(who)} ${STATUS_SENTENCE[status]} this invitation.</p>`,
			ics
		});
		return { ok: true, warnings: [] };
	} catch (error) {
		return { ok: true, warnings: [`Your answer was saved, but the organizer was not emailed: ${error instanceof Error ? error.message : 'send failed'}`] };
	}
}

-- Calendar phases 2–4: invitations, reminders, feeds and subscriptions.

-- iCalendar identity. Every event in an invitation (and an imported or subscribed
-- event) carries the sender's UID; a moved single date of an invited series keeps
-- the series UID plus the date it replaced (`recurrence_id`, an occurrence date).
ALTER TABLE calendar_events ADD COLUMN ical_uid TEXT;
ALTER TABLE calendar_events ADD COLUMN recurrence_id TEXT;
ALTER TABLE calendar_events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
-- Invitations. `organizer` is JSON {email, name}. `attendees` is JSON
-- [{email, name, status}]. `my_email` / `my_status` are set when someone else
-- invited this user (my_email is the address that received it); both are NULL on
-- the user's own events.
ALTER TABLE calendar_events ADD COLUMN organizer TEXT;
ALTER TABLE calendar_events ADD COLUMN attendees TEXT NOT NULL DEFAULT '[]';
ALTER TABLE calendar_events ADD COLUMN my_email TEXT;
ALTER TABLE calendar_events ADD COLUMN my_status TEXT;
-- Minutes before the start (timed) or before 09:00 on the day (all-day), JSON array.
ALTER TABLE calendar_events ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_calendar_events_uid ON calendar_events(user_id, ical_uid) WHERE ical_uid IS NOT NULL;
CREATE INDEX idx_calendar_events_reminders ON calendar_events(start_at) WHERE reminders != '[]';

-- A calendar with a source URL is a read-only subscription refreshed on a schedule.
ALTER TABLE calendars ADD COLUMN source_url TEXT;
ALTER TABLE calendars ADD COLUMN synced_at TEXT;
ALTER TABLE calendars ADD COLUMN sync_error TEXT;

CREATE TABLE calendar_settings (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	time_zone TEXT NOT NULL DEFAULT 'UTC',
	-- Minutes before new timed events; NULL means no reminder by default.
	default_reminder INTEGER DEFAULT 10,
	agenda_email INTEGER NOT NULL DEFAULT 0,
	agenda_hour INTEGER NOT NULL DEFAULT 7,
	agenda_sent_on TEXT,
	-- Private subscribe link (read-only .ics of every calendar).
	feed_token TEXT UNIQUE,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per reminder delivered, so the every-minute job never repeats one.
CREATE TABLE calendar_reminders_sent (
	event_id TEXT NOT NULL,
	fire_at TEXT NOT NULL,
	sent_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (event_id, fire_at)
);
CREATE INDEX idx_calendar_reminders_sent_at ON calendar_reminders_sent(sent_at);

-- Personal calendars. Each user gets a default calendar on first use.
CREATE TABLE calendars (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL,
	is_default INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_calendars_user ON calendars(user_id);

-- Timed events store UTC instants (2026-11-14T15:00:00.000Z); all-day events store
-- dates (2026-11-14) with an exclusive end. Both sort as text, so one range query
-- covers them. A repeating event is one row with an RRULE; `recur_until` is the last
-- possible occurrence start (NULL = never ends) so range queries skip finished series.
CREATE TABLE calendar_events (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	location TEXT NOT NULL DEFAULT '',
	all_day INTEGER NOT NULL DEFAULT 0,
	start_at TEXT NOT NULL,
	end_at TEXT NOT NULL,
	time_zone TEXT NOT NULL,
	rrule TEXT,
	exdates TEXT NOT NULL DEFAULT '[]',
	recur_until TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_calendar_events_range ON calendar_events(user_id, start_at);
CREATE INDEX idx_calendar_events_series ON calendar_events(user_id, recur_until) WHERE rrule IS NOT NULL;

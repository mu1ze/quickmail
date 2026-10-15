/**
 * Live availability for signatures. The sent email points at /s/status with the
 * schedule in the query string; when a recipient opens the email the server
 * picks which pre-rendered badge to return. Nothing is looked up or recorded
 * per open — the URL carries everything the choice needs.
 */

export type LiveState = 'available' | 'away' | 'ooo';

export type LiveSchedule = {
	/** IANA zone the hours are in, e.g. "America/Toronto". */
	tz: string;
	/** Working hours as minutes after midnight; end < start wraps past midnight. */
	start: number;
	end: number;
	/** Working days, 0 = Sunday … 6 = Saturday. */
	days: number[];
	/** Optional out-of-office range, inclusive, as YYYY-MM-DD in `tz`. */
	oooFrom: string;
	oooTo: string;
};

export type LiveAssetIds = { available: string; away: string; ooo: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
	if (!tz || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export function isLiveDate(value: string): boolean {
	if (!DATE_RE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Wall-clock date, weekday and minute of day for `now` in `tz`. */
export function zonedNow(now: Date, tz: string): { date: string; weekday: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	return {
		date: `${get('year')}-${get('month')}-${get('day')}`,
		weekday: WEEKDAYS[get('weekday')] ?? 0,
		minutes: Number(get('hour')) * 60 + Number(get('minute'))
	};
}

export function pickLiveState(now: Date, schedule: LiveSchedule, hasOoo = true): LiveState {
	const local = zonedNow(now, schedule.tz);
	if (hasOoo && schedule.oooFrom && schedule.oooTo && local.date >= schedule.oooFrom && local.date <= schedule.oooTo) {
		return 'ooo';
	}
	const { start, end } = schedule;
	if (start === end) return 'away';
	if (start < end) {
		return schedule.days.includes(local.weekday) && local.minutes >= start && local.minutes < end ? 'available' : 'away';
	}
	// Overnight shift: the late part belongs to today's workday, the early part to yesterday's.
	if (local.minutes >= start) return schedule.days.includes(local.weekday) ? 'available' : 'away';
	if (local.minutes < end) return schedule.days.includes((local.weekday + 6) % 7) ? 'available' : 'away';
	return 'away';
}

export function formatLiveTime(minutes: number): string {
	const h = Math.floor(minutes / 60) % 24;
	const m = minutes % 60;
	const suffix = h < 12 ? 'AM' : 'PM';
	const hour = h % 12 === 0 ? 12 : h % 12;
	return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

/** "Oct 28" for the day after an out-of-office range ends. */
export function formatReturnDate(oooTo: string): string {
	const next = new Date(`${oooTo}T12:00:00Z`);
	next.setUTCDate(next.getUTCDate() + 1);
	return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Short zone name such as "EDT", falling back to the city part of the IANA name. */
export function zoneLabel(tz: string, now = new Date()): string {
	try {
		const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
			.formatToParts(now)
			.find((part) => part.type === 'timeZoneName')?.value;
		if (name && !/^GMT[+-]/.test(name)) return name;
	} catch {
		/* fall through */
	}
	return tz.split('/').pop()?.replaceAll('_', ' ') ?? tz;
}

export function liveStatusPath(ids: LiveAssetIds, schedule: LiveSchedule): string {
	const params = new URLSearchParams({
		a: ids.available,
		o: ids.away,
		tz: schedule.tz,
		h: `${schedule.start}-${schedule.end}`,
		d: [...schedule.days].sort().join('')
	});
	if (ids.ooo && schedule.oooFrom && schedule.oooTo) {
		params.set('v', ids.ooo);
		params.set('f', schedule.oooFrom);
		params.set('t', schedule.oooTo);
	}
	return `/s/status?${params}`;
}

/** Reads a /s/status query back, rejecting anything malformed. */
export function parseLiveStatusQuery(params: URLSearchParams): { ids: LiveAssetIds; schedule: LiveSchedule } | null {
	const available = params.get('a') ?? '';
	const away = params.get('o') ?? '';
	const ooo = params.get('v');
	const tz = params.get('tz') ?? '';
	const hours = /^(\d{1,4})-(\d{1,4})$/.exec(params.get('h') ?? '');
	const days = params.get('d') ?? '';
	if (!UUID_RE.test(available) || !UUID_RE.test(away) || (ooo !== null && !UUID_RE.test(ooo))) return null;
	if (!isValidTimeZone(tz) || !hours || !/^[0-6]{0,7}$/.test(days)) return null;
	const start = Number(hours[1]);
	const end = Number(hours[2]);
	if (start > 1440 || end > 1440) return null;
	const oooFrom = params.get('f') ?? '';
	const oooTo = params.get('t') ?? '';
	const withOoo = ooo !== null && isLiveDate(oooFrom) && isLiveDate(oooTo) && oooFrom <= oooTo;
	return {
		ids: { available, away, ooo: withOoo ? ooo : null },
		schedule: {
			tz,
			start,
			end,
			days: [...new Set(days.split('').map(Number))],
			oooFrom: withOoo ? oooFrom : '',
			oooTo: withOoo ? oooTo : ''
		}
	};
}

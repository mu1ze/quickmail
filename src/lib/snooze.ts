/** Presets copied from Gmail/Superhuman: few choices, obvious names, no picker by default. */

export type SnoozePreset = {
	id: string;
	label: string;
	hint: string;
	/** `null` means the caller should open a datetime field. */
	at: (now: Date) => Date | null;
};

function atHour(now: Date, daysFromToday: number, hour: number): Date {
	const next = new Date(now);
	next.setDate(now.getDate() + daysFromToday);
	next.setHours(hour, 0, 0, 0);
	if (next.getTime() <= now.getTime()) {
		next.setDate(next.getDate() + 1);
	}
	return next;
}

function nextWeekday(now: Date, weekday: number, hour: number): Date {
	const next = new Date(now);
	next.setHours(hour, 0, 0, 0);
	const delta = (weekday - now.getDay() + 7) % 7;
	next.setDate(now.getDate() + (delta === 0 ? 7 : delta));
	return next;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
	{
		id: 'later-today',
		label: 'Later today',
		hint: 'in 3 hours',
		at: (now) => {
			const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
			const evening = atHour(now, 0, 18);
			return later.getHours() >= 21 ? evening : later;
		}
	},
	{
		id: 'tomorrow',
		label: 'Tomorrow morning',
		hint: '8:00',
		at: (now) => atHour(now, 1, 8)
	},
	{
		id: 'evening',
		label: 'Tomorrow evening',
		hint: '18:00',
		at: (now) => atHour(now, 1, 18)
	},
	{
		id: 'monday',
		label: 'Monday morning',
		hint: '8:00',
		at: (now) => nextWeekday(now, 1, 8)
	},
	{
		id: 'next-week',
		label: 'Next week',
		hint: 'Monday 8:00',
		at: (now) => {
			const monday = nextWeekday(now, 1, 8);
			// If "Monday morning" is already next Monday, skip one more week.
			const daysOut = (monday.getTime() - now.getTime()) / 86_400_000;
			if (daysOut < 6) monday.setDate(monday.getDate() + 7);
			return monday;
		}
	},
	{
		id: 'custom',
		label: 'Pick a time',
		hint: '',
		at: () => null
	}
];

/** SQLite `datetime('now')` format (UTC, no timezone suffix). */
export function toSqliteDatetime(date: Date): string {
	return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export function fromSqliteDatetime(value: string): Date {
	const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
	return new Date(iso);
}

export function formatSnoozeUntil(value: string, now = new Date()): string {
	const date = fromSqliteDatetime(value);
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	if (sameDay) return `Today ${time}`;
	const tomorrow = new Date(now);
	tomorrow.setDate(now.getDate() + 1);
	if (
		date.getFullYear() === tomorrow.getFullYear() &&
		date.getMonth() === tomorrow.getMonth() &&
		date.getDate() === tomorrow.getDate()
	) {
		return `Tomorrow ${time}`;
	}
	return date.toLocaleString([], {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

export function resolveSnoozePreset(id: string, now = new Date()): Date | null {
	const preset = SNOOZE_PRESETS.find((entry) => entry.id === id);
	return preset ? preset.at(now) : null;
}

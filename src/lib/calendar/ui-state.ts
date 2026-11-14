import { writable } from 'svelte/store';
import type { DateKey } from './time';

const HIDDEN_KEY = 'calendar:hidden';

function readHidden(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** Calendars the viewer has switched off (per browser). */
export const hiddenCalendars = writable<string[]>([]);

let loaded = false;
export function loadHiddenCalendars(): void {
	if (loaded || typeof localStorage === 'undefined') return;
	loaded = true;
	hiddenCalendars.set(readHidden());
	hiddenCalendars.subscribe((ids) => {
		try {
			localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
		} catch {
			/* storage unavailable */
		}
	});
}

export function toggleCalendar(id: string): void {
	hiddenCalendars.update((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
}

export type NewEventRequest = { at: number; date?: DateKey };

/** The sidebar, dock and `c` key ask the calendar page to open a blank event. */
export const newEventRequest = writable<NewEventRequest | null>(null);

export function requestNewEvent(date?: DateKey): void {
	newEventRequest.set({ at: Date.now(), date });
}

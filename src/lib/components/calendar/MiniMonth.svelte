<script lang="ts">
	import { goto } from '$app/navigation';
	import { addDays, addMonths, monthName, splitDateKey, startOfMonth, startOfWeek, weekdayName, type DateKey } from '$lib/calendar/time';
	import { WEEK_STARTS_ON, daysBetween } from '$lib/calendar/layout';
	import type { CalendarView } from '$lib/calendar/types';
	import Icon from '../Icon.svelte';

	let { selected, today, view, range, onPick }: { selected: DateKey; today: DateKey; view: CalendarView; range: { from: DateKey; to: DateKey }; onPick?: () => void } = $props();

	// Follows the main calendar; the arrows browse months until it moves again.
	let cursor = $derived(startOfMonth(selected));

	const cursorParts = $derived(splitDateKey(cursor));
	const days = $derived(daysBetween(startOfWeek(cursor, WEEK_STARTS_ON), addDays(startOfWeek(cursor, WEEK_STARTS_ON), 42)));
	const headers = $derived(days.slice(0, 7));

	function pick(day: DateKey) {
		onPick?.();
		void goto(`/calendar?view=${view === 'agenda' ? 'day' : view}&date=${day}`, { keepFocus: true, noScroll: true });
	}
</script>

<div class="mini">
	<div class="mini-head">
		<span>{monthName(cursorParts.month)} {cursorParts.year}</span>
		<button type="button" aria-label="Previous month" onclick={() => (cursor = addMonths(cursor, -1))}><Icon name="arrow-left-s-line" size={16} /></button>
		<button type="button" aria-label="Next month" onclick={() => (cursor = addMonths(cursor, 1))}><Icon name="arrow-right-s-line" size={16} /></button>
	</div>
	<div class="mini-grid" role="grid" aria-label="Pick a date">
		{#each headers as day (day)}<span class="dow" aria-hidden="true">{weekdayName(new Date(`${day}T00:00:00Z`).getUTCDay(), 'narrow')}</span>{/each}
		{#each days as day (day)}
			<button
				type="button"
				class:outside={splitDateKey(day).month !== cursorParts.month}
				class:today={day === today}
				class:selected={day === selected}
				class:in-range={view !== 'month' && view !== 'agenda' && day >= range.from && day < range.to}
				aria-label={day}
				onclick={() => pick(day)}
			>{splitDateKey(day).day}</button>
		{/each}
	</div>
</div>

<style>
	.mini { padding: 0 0.25rem 0.5rem; }
	.mini-head { display: flex; align-items: center; gap: 0.125rem; padding: 0 0.25rem 0.35rem 0.5rem; font-size: 0.8125rem; font-weight: 600; color: var(--color-text); }
	.mini-head span { flex: 1; }
	.mini-head button { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 8px; color: var(--color-muted); }
	.mini-head button:hover { background: var(--color-surface-muted); color: var(--color-text); }
	.mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
	.dow { text-align: center; font-size: 0.625rem; font-weight: 600; color: var(--color-muted); padding-bottom: 0.15rem; }
	.mini-grid button { aspect-ratio: 1; display: grid; place-items: center; border-radius: 999px; font-size: 0.6875rem; color: var(--color-text-secondary); }
	.mini-grid button:hover { background: var(--color-surface-muted); color: var(--color-text); }
	.mini-grid button.outside { color: var(--color-muted); opacity: 0.6; }
	.mini-grid button.in-range { background: var(--color-accent-soft); border-radius: 0; }
	.mini-grid button.today { color: var(--color-accent-text); font-weight: 700; }
	.mini-grid button.selected { background: var(--color-accent); color: var(--color-on-accent); border-radius: 999px; font-weight: 600; opacity: 1; }
</style>

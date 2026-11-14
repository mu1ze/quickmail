<script lang="ts">
	import { daysBetween, localSpan, occurrencesOnDay } from '$lib/calendar/layout';
	import { addDays, dayLabel, minutesLabel, splitDateKey, type DateKey } from '$lib/calendar/time';
	import type { CalendarInfo, CalendarOccurrence } from '$lib/calendar/types';
	import Icon from '../Icon.svelte';

	let {
		from,
		to,
		occurrences,
		calendars,
		timeZone,
		today,
		onOpen,
		onPickDay
	}: {
		from: DateKey;
		to: DateKey;
		occurrences: CalendarOccurrence[];
		calendars: CalendarInfo[];
		timeZone: string;
		today: DateKey;
		onOpen: (occurrence: CalendarOccurrence) => void;
		onPickDay: (date: DateKey) => void;
	} = $props();

	const byId = $derived(Object.fromEntries(calendars.map((calendar) => [calendar.id, calendar])));
	const groups = $derived(
		daysBetween(from, to)
			.map((day) => ({ day, items: occurrencesOnDay(occurrences, day, timeZone) }))
			.filter((group) => group.items.length)
	);
	const year = $derived(splitDateKey(today).year);

	function when(occurrence: CalendarOccurrence, day: DateKey): string {
		if (occurrence.allDay) return 'All day';
		const span = localSpan(occurrence, timeZone);
		const startsToday = span.startDate === day;
		const endsToday = span.endDate === day || (span.endMinutes === 0 && span.endDate === addDays(day, 1));
		if (startsToday && endsToday) return `${minutesLabel(span.startMinutes)} – ${minutesLabel(span.endMinutes)}`;
		if (startsToday) return `From ${minutesLabel(span.startMinutes)}`;
		if (endsToday) return `Until ${minutesLabel(span.endMinutes)}`;
		return 'All day';
	}
</script>

<div class="agenda">
	{#each groups as group (group.day)}
		<section class="day" class:today={group.day === today}>
			<button type="button" class="day-label" onclick={() => onPickDay(group.day)}>
				<span class="num">{splitDateKey(group.day).day}</span>
				<span class="name">{group.day === today ? 'Today · ' : ''}{dayLabel(group.day, year)}</span>
			</button>
			<ul>
				{#each group.items as occurrence (occurrence.id)}
					<li>
						<button type="button" class="item" onclick={() => onOpen(occurrence)} style="--ev:{byId[occurrence.calendarId]?.color ?? 'var(--color-accent)'}">
							<span class="dot"></span>
							<span class="when">{when(occurrence, group.day)}</span>
							<span class="what">
								<span class="title">{occurrence.title || '(No title)'}</span>
								{#if occurrence.location}<span class="where"><Icon name="map-pin-line" size={12} />{occurrence.location}</span>{/if}
							</span>
							{#if occurrence.rrule}<Icon name="repeat-line" size={14} class="repeat" />{/if}
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<div class="empty">
			<Icon name="calendar-check-line" size={28} />
			<p>Nothing scheduled for the next 30 days.</p>
		</div>
	{/each}
</div>

<style>
	.agenda { flex: 1; min-height: 0; overflow-y: auto; padding: 0.5rem 1.5rem 2rem; }
	.day { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 0.5rem; padding: 0.6rem 0; border-bottom: 1px solid var(--color-line); }
	.day-label { display: flex; align-items: baseline; gap: 0.6rem; align-self: start; padding: 0.35rem 0.5rem; border-radius: 10px; text-align: left; color: var(--color-text-secondary); }
	.day-label:hover { background: var(--color-surface-muted); }
	.num { font-size: 1.25rem; font-weight: 600; color: var(--color-text); min-width: 1.6rem; }
	.name { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
	.today .num, .today .name { color: var(--color-accent-text); }
	ul { display: flex; flex-direction: column; gap: 0.125rem; }
	.item { display: grid; grid-template-columns: 0.6rem 8.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; width: 100%; min-height: 2.5rem; padding: 0.35rem 0.75rem; border-radius: 10px; text-align: left; }
	.item:hover { background: var(--color-surface-muted); }
	.dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--ev); }
	.when { font-size: 0.8125rem; color: var(--color-text-secondary); white-space: nowrap; }
	.what { display: flex; flex-direction: column; min-width: 0; }
	.title { font-size: 0.875rem; font-weight: 500; color: var(--color-text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.where { display: flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; color: var(--color-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.item :global(.repeat) { color: var(--color-muted); }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 4rem 1rem; color: var(--color-muted); font-size: 0.875rem; }
	@media (max-width: 900px) {
		.agenda { padding: 0 0.75rem 1.5rem; }
		.day { grid-template-columns: minmax(0, 1fr); gap: 0.15rem; }
		.item { grid-template-columns: 0.6rem 6rem minmax(0, 1fr) auto; gap: 0.6rem; padding: 0.35rem 0.5rem; }
	}
</style>

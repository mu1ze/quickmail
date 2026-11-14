<script lang="ts">
	import { daysBetween, layoutLane, localSpan, occurrencesOnDay, type LaneBar } from '$lib/calendar/layout';
	import { addDays, diffDays, minutesLabel, monthName, splitDateKey, weekday, weekdayName, zonedToUtc, type DateKey } from '$lib/calendar/time';
	import type { CalendarOccurrence } from '$lib/calendar/types';
	import type { CreateRequest, MoveRequest } from './TimeGrid.svelte';

	let {
		from,
		month,
		occurrences,
		colors,
		timeZone,
		today,
		onOpen,
		onCreate,
		onMove,
		onPickDay,
		locked = () => false
	}: {
		from: DateKey;
		/** 1–12: days outside it are dimmed. */
		month: number;
		occurrences: CalendarOccurrence[];
		colors: Record<string, string>;
		timeZone: string;
		today: DateKey;
		onOpen: (occurrence: CalendarOccurrence) => void;
		onCreate: (request: CreateRequest) => void;
		onMove: (request: MoveRequest) => void;
		onPickDay: (date: DateKey) => void;
		locked?: (occurrence: CalendarOccurrence) => boolean;
	} = $props();

	const ROW = 21;
	const HEAD = 26;
	const weeks = $derived(Array.from({ length: 6 }, (_, index) => daysBetween(addDays(from, index * 7), addDays(from, index * 7 + 7))));
	const lanes = $derived(weeks.map((days) => layoutLane(occurrences, days, timeZone, false)));

	let gridHeight = $state(600);
	const maxRows = $derived(Math.max(1, Math.floor((gridHeight / 6 - HEAD - 4) / ROW) - 1));

	function hiddenOn(bars: LaneBar[], index: number): number {
		return bars.filter((bar) => bar.row >= maxRows && bar.start <= index && bar.start + bar.span > index).length;
	}

	function label(bar: LaneBar): string {
		const o = bar.occurrence;
		const title = o.title || '(No title)';
		if (o.allDay || bar.span > 1) return title;
		return `${minutesLabel(localSpan(o, timeZone).startMinutes)} ${title}`;
	}

	let drag = $state<{ occurrence: CalendarOccurrence; pointerId: number; origin: DateKey; target: DateKey; x: number; y: number; moved: boolean } | null>(null);
	let swallowClick = false;

	function dateAt(x: number, y: number): DateKey | null {
		return (document.elementFromPoint(x, y)?.closest('[data-date]') as HTMLElement | null)?.dataset.date ?? null;
	}

	function startDrag(event: PointerEvent, occurrence: CalendarOccurrence) {
		if (event.button !== 0 || event.pointerType === 'touch') return;
		if (locked(occurrence)) {
			event.stopPropagation();
			return;
		}
		const origin = dateAt(event.clientX, event.clientY);
		if (!origin) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { occurrence, pointerId: event.pointerId, origin, target: origin, x: event.clientX, y: event.clientY, moved: false };
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
		drag.moved = true;
		drag.target = dateAt(event.clientX, event.clientY) ?? drag.target;
	}

	function finishDrag(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const current = drag;
		drag = null;
		if (!current.moved) return;
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
		const days = diffDays(current.origin, current.target);
		if (!days) return;
		const o = current.occurrence;
		if (o.allDay) {
			onMove({ occurrence: o, start: addDays(o.start, days), end: addDays(o.end, days) });
		} else {
			const span = localSpan(o, timeZone);
			const start = zonedToUtc(addDays(span.startDate, days), span.startMinutes, timeZone);
			onMove({ occurrence: o, start: new Date(start).toISOString(), end: new Date(start + Date.parse(o.end) - Date.parse(o.start)).toISOString() });
		}
	}
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={finishDrag} onpointercancel={() => (drag = null)} />

<div class="month" style="--row:{ROW}px;--head:{HEAD}px">
	<div class="dows" aria-hidden="true">
		{#each weeks[0] as day (day)}<span>{weekdayName(weekday(day), 'short')}</span>{/each}
	</div>
	<div class="weeks" bind:clientHeight={gridHeight}>
		{#each weeks as days, weekIndex (days[0])}
			{@const bars = lanes[weekIndex]}
			<div class="week">
				{#each days as day, index (day)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="cell"
						class:outside={splitDateKey(day).month !== month}
						class:today={day === today}
						class:drop={drag?.moved && drag.target === day}
						data-date={day}
						onclick={() => { if (swallowClick) return; if (matchMedia('(max-width: 640px)').matches) onPickDay(day); else onCreate({ date: day }); }}
					>
						<button type="button" class="num" onclick={(event) => { event.stopPropagation(); onPickDay(day); }} aria-label={`Show ${day}`}>{splitDateKey(day).day === 1 ? `${monthName(splitDateKey(day).month, true)} 1` : splitDateKey(day).day}</button>
						{#if hiddenOn(bars, index)}
							<button type="button" class="more" style="top:calc(var(--head) + {maxRows} * var(--row))" onclick={(event) => { event.stopPropagation(); onPickDay(day); }}>+{hiddenOn(bars, index)} more</button>
						{/if}
						<span class="dots" aria-hidden="true">
							{#each occurrencesOnDay(occurrences, day, timeZone).slice(0, 4) as o (o.id)}<i style="--ev:{colors[o.calendarId] ?? 'var(--color-accent)'}"></i>{/each}
						</span>
					</div>
				{/each}
				{#each bars.filter((bar) => bar.row < maxRows) as bar (bar.occurrence.id)}
					{@const timed = !bar.occurrence.allDay && bar.span === 1}
					<button
						type="button"
						class="bar"
						class:timed
						class:cont-before={bar.continuesBefore}
						class:cont-after={bar.continuesAfter}
						class:dragging={drag?.moved && drag.occurrence.id === bar.occurrence.id}
						class:pending={bar.occurrence.myStatus === 'needs-action'}
						class:tentative={bar.occurrence.myStatus === 'tentative'}
						style="left:calc({bar.start} * 100% / 7 + 2px);width:calc({bar.span} * 100% / 7 - 4px);top:calc(var(--head) + {bar.row} * var(--row));--ev:{colors[bar.occurrence.calendarId] ?? 'var(--color-accent)'}"
						onpointerdown={(event) => startDrag(event, bar.occurrence)}
						onclick={(event) => { event.stopPropagation(); if (!swallowClick) onOpen(bar.occurrence); }}
					>{#if timed}<i></i>{/if}<span>{label(bar)}</span></button>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.month { display: flex; flex-direction: column; flex: 1; min-height: 0; }
	.dows { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--color-line); }
	.dows span { padding: 0.5rem 0; text-align: center; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-secondary); }
	.weeks { flex: 1; min-height: 0; display: grid; grid-template-rows: repeat(6, minmax(0, 1fr)); }
	.week { position: relative; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--color-line); min-height: 0; }
	.week:last-child { border-bottom: 0; }
	.cell { position: relative; min-width: 0; border-left: 1px solid var(--color-line); cursor: cell; }
	.cell:first-child { border-left: 0; }
	.cell.outside { background: color-mix(in srgb, var(--color-well) 55%, transparent); }
	.cell.outside .num { color: var(--color-muted); }
	.cell.drop { background: var(--color-accent-soft); }
	.num { position: absolute; top: 3px; left: 50%; transform: translateX(-50%); min-width: 1.5rem; height: 1.5rem; padding: 0 0.35rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; color: var(--color-text); white-space: nowrap; }
	.num:hover { background: var(--color-surface-hover); }
	.cell.today .num { background: var(--color-accent); color: var(--color-on-accent); }
	.more { position: absolute; left: 4px; right: 4px; height: var(--row); padding: 0 0.4rem; border-radius: 6px; text-align: left; font-size: 0.6875rem; font-weight: 600; color: var(--color-text-secondary); }
	.more:hover { background: var(--color-surface-hover); color: var(--color-text); }
	.dots { display: none; }
	.bar { position: absolute; z-index: 1; display: flex; align-items: center; gap: 0.3rem; height: calc(var(--row) - 2px); padding: 0 0.4rem; border-radius: 6px; overflow: hidden; font-size: 0.75rem; font-weight: 500; text-align: left; color: var(--color-text); background: color-mix(in srgb, var(--ev) 26%, var(--color-surface)); box-shadow: inset 3px 0 0 var(--ev); cursor: pointer; }
	.bar span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.bar:hover { background: color-mix(in srgb, var(--ev) 36%, var(--color-surface)); }
	/* Invitations not yet answered: outlined; "maybe": striped. */
	.pending { background: var(--color-surface) !important; box-shadow: inset 0 0 0 1.5px var(--ev) !important; }
	.bar.timed.pending, .bar.timed.tentative { background: transparent !important; box-shadow: none !important; font-style: italic; }
	.tentative { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ev) 26%, var(--color-surface)) 0 6px, var(--color-surface) 6px 11px) !important; }
	.bar.timed { background: transparent; box-shadow: none; font-weight: 400; }
	.bar.timed:hover { background: var(--color-surface-hover); }
	.bar.timed i { flex-shrink: 0; width: 0.45rem; height: 0.45rem; border-radius: 50%; background: var(--ev); }
	.bar.cont-before { border-top-left-radius: 0; border-bottom-left-radius: 0; box-shadow: none; }
	.bar.cont-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
	.bar.dragging { opacity: 0.35; }

	/* Phones: dots per day; tapping a day opens it. */
	@media (max-width: 640px) {
		.bar, .more { display: none; }
		.cell { cursor: pointer; }
		.dots { position: absolute; left: 0; right: 0; top: calc(var(--head) + 4px); display: flex; justify-content: center; gap: 3px; }
		.dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ev); }
	}
</style>

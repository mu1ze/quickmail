<script lang="ts">
	import { layoutLane, layoutTimedDay, localSpan, snap, type LaneBar } from '$lib/calendar/layout';
	import { addDays, diffDays, minutesLabel, splitDateKey, weekday, weekdayName, zonedParts, zonedToUtc, type DateKey } from '$lib/calendar/time';
	import type { CalendarOccurrence } from '$lib/calendar/types';

	export type MoveRequest = { occurrence: CalendarOccurrence; start: string; end: string };
	export type CreateRequest = { date: DateKey; startMinutes?: number; endMinutes?: number; allDay?: boolean };

	let {
		days,
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
		days: DateKey[];
		occurrences: CalendarOccurrence[];
		colors: Record<string, string>;
		timeZone: string;
		today: DateKey;
		onOpen: (occurrence: CalendarOccurrence) => void;
		onCreate: (request: CreateRequest) => void;
		onMove: (request: MoveRequest) => void;
		onPickDay: (date: DateKey) => void;
		/** Events that cannot be dragged (subscriptions, invitations from others). */
		locked?: (occurrence: CalendarOccurrence) => boolean;
	} = $props();

	const HOUR = 48;
	const hours = Array.from({ length: 24 }, (_, hour) => hour);

	const columns = $derived(days.map((day) => ({ day, blocks: layoutTimedDay(occurrences, day, timeZone) })));
	const lane = $derived(layoutLane(occurrences, days, timeZone));
	const laneRows = $derived(lane.reduce((rows, bar) => Math.max(rows, bar.row + 1), 0));

	let scroller = $state<HTMLDivElement>();
	let body = $state<HTMLDivElement>();
	let now = $state(Date.now());
	const nowParts = $derived(zonedParts(now, timeZone));

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	// Open on the working day (or just before now when today is visible).
	let scrolled = false;
	$effect(() => {
		if (!scroller || scrolled) return;
		scrolled = true;
		const minutes = days.includes(today) ? Math.max(0, nowParts.minutes - 90) : 7 * 60 + 30;
		scroller.scrollTop = (minutes / 60) * HOUR;
	});

	type Drag = {
		kind: 'move' | 'resize' | 'create';
		occurrence?: CalendarOccurrence;
		pointerId: number;
		x: number;
		y: number;
		dayIndex: number;
		startMinutes: number;
		moved: boolean;
		dayDelta: number;
		minuteDelta: number;
	};
	let drag = $state<Drag | null>(null);
	// Mouse gestures finish in pointerup; the click that follows must not act twice.
	let swallowClick = false;
	function swallowNextClick() {
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
	}

	function columnWidth(): number {
		return (body?.querySelector('.cols')?.getBoundingClientRect().width ?? 1) / days.length;
	}

	function minutesAt(event: PointerEvent, column: HTMLElement): number {
		const rect = column.getBoundingClientRect();
		return Math.min(1440, Math.max(0, ((event.clientY - rect.top) / HOUR) * 60));
	}

	function startBlockDrag(event: PointerEvent, occurrence: CalendarOccurrence, dayIndex: number, kind: 'move' | 'resize') {
		if (event.button !== 0 || event.pointerType === 'touch') return;
		event.stopPropagation();
		if (locked(occurrence)) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { kind, occurrence, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dayIndex, startMinutes: 0, moved: false, dayDelta: 0, minuteDelta: 0 };
	}

	function startCreate(event: PointerEvent, dayIndex: number) {
		if (event.button !== 0 || event.pointerType === 'touch') return;
		const column = event.currentTarget as HTMLElement;
		column.setPointerCapture(event.pointerId);
		const minutes = Math.floor(minutesAt(event, column) / 15) * 15;
		drag = { kind: 'create', pointerId: event.pointerId, x: event.clientX, y: event.clientY, dayIndex, startMinutes: minutes, moved: false, dayDelta: 0, minuteDelta: 0 };
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 5) return;
		drag.moved = true;
		drag.minuteDelta = snap((dy / HOUR) * 60);
		drag.dayDelta = drag.kind === 'move' ? Math.max(-drag.dayIndex, Math.min(days.length - 1 - drag.dayIndex, Math.round(dx / columnWidth()))) : 0;
	}

	function finishDrag(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const current = drag;
		drag = null;
		if (current.kind === 'create') {
			swallowNextClick();
			const day = days[current.dayIndex];
			if (!current.moved) {
				const start = Math.floor(current.startMinutes / 30) * 30;
				onCreate({ date: day, startMinutes: start, endMinutes: Math.min(start + 60, 1440) });
			} else {
				const a = current.startMinutes;
				const b = Math.min(1440, Math.max(0, current.startMinutes + current.minuteDelta));
				const [start, end] = a <= b ? [a, b] : [b, a];
				onCreate({ date: day, startMinutes: start, endMinutes: Math.max(end, start + 15) });
			}
			return;
		}
		const occurrence = current.occurrence!;
		if (!current.moved) return;
		swallowNextClick();
		if (!current.minuteDelta && !current.dayDelta) return;
		const span = localSpan(occurrence, timeZone);
		const startMs = Date.parse(occurrence.start);
		const endMs = Date.parse(occurrence.end);
		if (current.kind === 'move') {
			const start = zonedToUtc(addDays(span.startDate, current.dayDelta), span.startMinutes + current.minuteDelta, timeZone);
			onMove({ occurrence, start: new Date(start).toISOString(), end: new Date(start + (endMs - startMs)).toISOString() });
		} else {
			const end = Math.max(startMs + 15 * 60_000, zonedToUtc(span.endDate, span.endMinutes + current.minuteDelta, timeZone));
			onMove({ occurrence, start: occurrence.start, end: new Date(end).toISOString() });
		}
	}

	/** Touch has no drag-to-create; a tap makes a one-hour event at that slot. */
	function tapCreate(event: MouseEvent, day: DateKey) {
		if (swallowClick) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const start = Math.min(23 * 60, Math.floor((((event.clientY - rect.top) / HOUR) * 60) / 30) * 30);
		onCreate({ date: day, startMinutes: start, endMinutes: start + 60 });
	}

	function cancelDrag() {
		drag = null;
	}

	function blockStyle(top: number, bottom: number, column: number, count: number, color: string): string {
		const width = 100 / count;
		return `top:${(top / 60) * HOUR}px;height:${Math.max(18, ((bottom - top) / 60) * HOUR - 2)}px;left:calc(${column * width}% + 1px);width:calc(${width}% - 3px);--ev:${color}`;
	}

	function previewFor(dayIndex: number): { top: number; bottom: number; title: string; color: string } | null {
		if (!drag?.moved) return null;
		if (drag.kind === 'create') {
			if (dayIndex !== drag.dayIndex) return null;
			const b = Math.min(1440, Math.max(0, drag.startMinutes + drag.minuteDelta));
			const [top, bottom] = drag.startMinutes <= b ? [drag.startMinutes, b] : [b, drag.startMinutes];
			return { top, bottom: Math.max(bottom, top + 15), title: '(No title)', color: 'var(--color-accent)' };
		}
		const occurrence = drag.occurrence!;
		const span = localSpan(occurrence, timeZone);
		const startIndex = diffDays(days[0], span.startDate);
		const color = colors[occurrence.calendarId] ?? 'var(--color-accent)';
		if (drag.kind === 'move') {
			if (dayIndex !== startIndex + drag.dayDelta) return null;
			const duration = (Date.parse(occurrence.end) - Date.parse(occurrence.start)) / 60_000;
			const top = Math.max(0, span.startMinutes + drag.minuteDelta);
			return { top, bottom: Math.min(1440, top + duration), title: occurrence.title || '(No title)', color };
		}
		if (dayIndex !== diffDays(days[0], span.endDate) && !(span.endMinutes === 0 && dayIndex === diffDays(days[0], span.endDate) - 1)) return null;
		const end = span.endMinutes === 0 ? 1440 : span.endMinutes;
		const top = span.startDate === days[dayIndex] ? span.startMinutes : 0;
		return { top, bottom: Math.max(top + 15, Math.min(1440, end + drag.minuteDelta)), title: occurrence.title || '(No title)', color };
	}

	function timeRange(occurrence: CalendarOccurrence): string {
		const span = localSpan(occurrence, timeZone);
		return `${minutesLabel(span.startMinutes)} – ${minutesLabel(span.endMinutes)}`;
	}

	function barLabel(bar: LaneBar): string {
		const o = bar.occurrence;
		if (o.allDay) return o.title || '(No title)';
		return `${minutesLabel(localSpan(o, timeZone).startMinutes)} ${o.title || '(No title)'}`;
	}

	function laneCreate(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const index = Math.min(days.length - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * days.length)));
		onCreate({ date: days[index], allDay: true });
	}
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={finishDrag} onpointercancel={cancelDrag} onkeydown={(event) => { if (event.key === 'Escape' && drag) cancelDrag(); }} />

<div class="grid" class:single={days.length === 1} style="--days:{days.length};--hour:{HOUR}px">
	<div class="head">
		<div class="gutter"></div>
		{#each days as day (day)}
			<button type="button" class="day-head" class:today={day === today} onclick={() => onPickDay(day)} aria-label={`Show ${weekdayName(weekday(day))}, ${day}`}>
				<span class="dow">{weekdayName(weekday(day), 'short')}</span>
				<span class="num">{splitDateKey(day).day}</span>
			</button>
		{/each}
	</div>

	<div class="lane">
		<div class="gutter lane-label">All day</div>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="lane-cells" style="--rows:{Math.max(1, laneRows)}" onclick={laneCreate}>
			{#each lane as bar (bar.occurrence.id)}
				<button
					type="button"
					class="bar"
					class:cont-before={bar.continuesBefore}
					class:cont-after={bar.continuesAfter}
					class:pending={bar.occurrence.myStatus === 'needs-action'}
					class:tentative={bar.occurrence.myStatus === 'tentative'}
					style="grid-column:{bar.start + 1} / span {bar.span};grid-row:{bar.row + 1};--ev:{colors[bar.occurrence.calendarId] ?? 'var(--color-accent)'}"
					onclick={(event) => { event.stopPropagation(); onOpen(bar.occurrence); }}
				>{barLabel(bar)}</button>
			{/each}
		</div>
	</div>

	<div class="scroll" bind:this={scroller}>
		<div class="body" bind:this={body} style="height:{24 * HOUR}px">
			<div class="gutter hours" aria-hidden="true">
				{#each hours as hour (hour)}
					{#if hour}<span style="top:{hour * HOUR}px">{minutesLabel(hour * 60)}</span>{/if}
				{/each}
			</div>
			<div class="cols">
				{#each columns as column, dayIndex (column.day)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="col" class:today={column.day === today} data-date={column.day} onpointerdown={(event) => startCreate(event, dayIndex)} onclick={(event) => tapCreate(event, column.day)} role="presentation">
						{#each column.blocks as block (block.occurrence.id)}
							{@const occurrence = block.occurrence}
							<div
								class="block"
								class:short={block.bottom - block.top < 45}
								class:dragging={drag?.moved && drag.occurrence?.id === occurrence.id}
								class:cont-before={block.continuesBefore}
								class:cont-after={block.continuesAfter}
								class:pending={occurrence.myStatus === 'needs-action'}
								class:tentative={occurrence.myStatus === 'tentative'}
								style={blockStyle(block.top, block.bottom, block.column, block.columns, colors[occurrence.calendarId] ?? 'var(--color-accent)')}
							>
								<button
									type="button"
									class="block-btn"
									onpointerdown={(event) => startBlockDrag(event, occurrence, dayIndex, 'move')}
									onclick={(event) => { event.stopPropagation(); if (!swallowClick) onOpen(occurrence); }}
								>
									<span class="title">{occurrence.title || '(No title)'}</span>
									<span class="time">{timeRange(occurrence)}{occurrence.location ? ` · ${occurrence.location}` : ''}</span>
								</button>
								{#if !block.continuesAfter && !locked(occurrence)}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="resize" onpointerdown={(event) => startBlockDrag(event, occurrence, dayIndex, 'resize')}></div>
								{/if}
							</div>
						{/each}
						{#if previewFor(dayIndex)}
							{@const preview = previewFor(dayIndex)!}
							<div class="block ghost" style={blockStyle(preview.top, preview.bottom, 0, 1, preview.color)}>
								<span class="title">{preview.title}</span>
								<span class="time">{minutesLabel(preview.top)} – {minutesLabel(preview.bottom)}</span>
							</div>
						{/if}
						{#if column.day === nowParts.date}
							<div class="now" style="top:{(nowParts.minutes / 60) * HOUR}px" aria-hidden="true"></div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.grid { display: flex; flex-direction: column; flex: 1; min-height: 0; --gutter-w: 3.75rem; }
	.head, .lane { display: flex; flex-shrink: 0; padding-right: var(--scrollbar, 0px); }
	.gutter { flex: 0 0 var(--gutter-w); }
	.head { border-bottom: 1px solid var(--color-line); }
	.day-head { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 0.15rem; padding: 0.5rem 0 0.45rem; color: var(--color-text-secondary); border-radius: 10px; }
	.day-head:hover { background: var(--color-surface-muted); }
	.dow { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	.num { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 999px; font-size: 1.125rem; font-weight: 500; color: var(--color-text); }
	.day-head.today .dow { color: var(--color-accent-text); }
	.day-head.today .num { background: var(--color-accent); color: var(--color-on-accent); }
	.single .day-head { flex-direction: row; justify-content: flex-start; gap: 0.6rem; padding-left: 0.75rem; flex: 0 0 auto; }

	.lane { border-bottom: 1px solid var(--color-line); min-height: 1.9rem; }
	.lane-label { display: flex; align-items: center; justify-content: flex-end; padding-right: 0.5rem; font-size: 0.6875rem; color: var(--color-muted); }
	.lane-cells { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(var(--days), minmax(0, 1fr)); grid-auto-rows: 1.4rem; gap: 2px 0; padding: 3px 0; cursor: cell; }
	.bar { margin: 0 2px; padding: 0 0.45rem; border-radius: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; font-size: 0.75rem; font-weight: 500; color: var(--color-text); background: color-mix(in srgb, var(--ev) 26%, var(--color-surface)); box-shadow: inset 3px 0 0 var(--ev); cursor: pointer; }
	.bar:hover { background: color-mix(in srgb, var(--ev) 36%, var(--color-surface)); }
	.bar.cont-before { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 0; box-shadow: none; }
	.bar.cont-after { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: 0; }

	.scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
	.head, .lane { scrollbar-gutter: stable; overflow: hidden; }
	.body { position: relative; display: flex; }
	.hours { position: relative; }
	.hours span { position: absolute; right: 0.5rem; transform: translateY(-50%); font-size: 0.6875rem; color: var(--color-muted); white-space: nowrap; }
	.cols { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(var(--days), minmax(0, 1fr)); }
	.col { position: relative; border-left: 1px solid var(--color-line); background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px), var(--color-line) calc(var(--hour) - 1px), var(--color-line) var(--hour)); cursor: cell; touch-action: pan-y; }
	.col.today { background-color: color-mix(in srgb, var(--color-accent) 4%, transparent); }

	/* Invitations not yet answered: outlined; "maybe": striped. */
	.pending { background: var(--color-surface) !important; box-shadow: inset 0 0 0 1.5px var(--ev) !important; }
	.tentative { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ev) 26%, var(--color-surface)) 0 6px, var(--color-surface) 6px 11px) !important; }
	.block { position: absolute; z-index: 1; display: flex; flex-direction: column; border-radius: 7px; overflow: hidden; color: var(--color-text); background: color-mix(in srgb, var(--ev) 24%, var(--color-surface)); box-shadow: inset 3px 0 0 var(--ev), 0 0 0 1px var(--color-surface); }
	.block:hover { z-index: 2; background: color-mix(in srgb, var(--ev) 34%, var(--color-surface)); }
	.block.dragging { opacity: 0.35; }
	.block.cont-before { border-top-left-radius: 0; border-top-right-radius: 0; }
	.block.cont-after { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
	.block-btn { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; min-height: 0; padding: 0.25rem 0.4rem 0.25rem 0.55rem; text-align: left; cursor: grab; overflow: hidden; }
	.block-btn:active { cursor: grabbing; }
	.title { font-size: 0.75rem; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
	.time { font-size: 0.6875rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	.block.short .block-btn { flex-direction: row; align-items: center; gap: 0.35rem; padding-top: 0; padding-bottom: 0; }
	.block.short .title { -webkit-line-clamp: 1; line-clamp: 1; flex-shrink: 0; max-width: 60%; }
	.resize { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
	.ghost { z-index: 3; pointer-events: none; padding: 0.25rem 0.4rem 0.25rem 0.55rem; gap: 0.1rem; box-shadow: inset 3px 0 0 var(--ev), var(--mat-float); background: color-mix(in srgb, var(--ev) 40%, var(--color-surface)); }
	.now { position: absolute; left: -1px; right: 0; z-index: 4; height: 2px; background: var(--color-danger); pointer-events: none; }
	.now::before { content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--color-danger); }

	@media (max-width: 900px) {
		.grid { --gutter-w: 2.75rem; }
		.hours span { font-size: 0.625rem; right: 0.3rem; }
		.dow { font-size: 0.625rem; }
		.num { width: 1.75rem; height: 1.75rem; font-size: 1rem; }
		.title { font-size: 0.6875rem; }
		.time { display: none; }
		.single .time, .block:not(.short) .time { display: block; }
		.grid:not(.single) .time { display: none; }
	}
</style>

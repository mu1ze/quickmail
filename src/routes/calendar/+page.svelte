<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/stores';
	import Icon from '$lib/components/Icon.svelte';
	import AccountSwitcher from '$lib/components/AccountSwitcher.svelte';
	import TimeGrid, { type CreateRequest, type MoveRequest } from '$lib/components/calendar/TimeGrid.svelte';
	import MonthGrid from '$lib/components/calendar/MonthGrid.svelte';
	import AgendaList from '$lib/components/calendar/AgendaList.svelte';
	import EventEditor from '$lib/components/calendar/EventEditor.svelte';
	import ScopeDialog from '$lib/components/calendar/ScopeDialog.svelte';
	import { blankDraft, draftFromOccurrence, draftToInput, type EventDraft } from '$lib/calendar/editor';
	import { daysBetween, stepDate, TZ_COOKIE, VIEW_COOKIE, viewTitle } from '$lib/calendar/layout';
	import { monthName, splitDateKey, zonedParts, type DateKey } from '$lib/calendar/time';
	import { CALENDAR_VIEWS, type CalendarOccurrence, type CalendarView, type EditScope, type EventInput } from '$lib/calendar/types';
	import { hiddenCalendars, loadHiddenCalendars, newEventRequest } from '$lib/calendar/ui-state';
	import { getShellContext } from '$lib/shell-context';
	import { isTypingTarget } from '$lib/shortcuts';
	import { showUndo } from '$lib/undo';
	import { requestError, requireOk } from '$lib/utils/request';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const shell = getShellContext();

	const VIEW_LABELS: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda' };
	const VIEW_KEYS: Record<string, CalendarView> = { d: 'day', w: 'week', m: 'month', a: 'agenda' };

	const colors = $derived(Object.fromEntries(data.calendars.map((calendar) => [calendar.id, calendar.color])));
	const visible = $derived(data.occurrences.filter((occurrence) => !$hiddenCalendars.includes(occurrence.calendarId)));
	const title = $derived(viewTitle(data.view, data.date));
	// Phones have room for the month; the year shows only when it is not this one.
	const phoneTitle = $derived.by(() => {
		const { month, year } = splitDateKey(data.date);
		return `${monthName(month)}${year === splitDateKey(data.today).year ? '' : ` ${year}`}`;
	});
	const defaultCalendar = $derived(data.calendars.find((calendar) => calendar.is_default) ?? data.calendars[0]);
	const subscribedIds = $derived(new Set(data.calendars.filter((calendar) => calendar.source_url).map((calendar) => calendar.id)));
	/** Subscriptions and other people's invitations keep their times. */
	const locked = (occurrence: CalendarOccurrence) => occurrence.myStatus !== null || subscribedIds.has(occurrence.calendarId);
	const days = $derived(daysBetween(data.range.from, data.range.to));

	let draft = $state<EventDraft | null>(null);
	let busy = $state(false);
	let editorError = $state('');
	let scopeDialog = $state<ReturnType<typeof ScopeDialog>>();

	$effect(() => loadHiddenCalendars());

	// Render in the browser's zone: tell the server once, then reload this page's data.
	$effect(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (zone && zone !== data.timeZone) {
			document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=31536000; SameSite=Lax`;
			void invalidate('app:calendar');
		}
	});

	// Phones start on the day view until a view has been picked.
	$effect(() => {
		if ($page.url.searchParams.has('view') || document.cookie.includes(`${VIEW_COOKIE}=`)) return;
		if (matchMedia('(max-width: 640px)').matches && data.view === 'week') void show('day', data.date, true);
	});

	$effect(() => {
		const request = $newEventRequest;
		if (!request) return;
		newEventRequest.set(null);
		openBlank({ date: request.date ?? (data.view === 'month' || data.view === 'agenda' ? data.today : data.date) });
	});

	function show(view: CalendarView, date: DateKey, replace = false) {
		if (view !== data.view) document.cookie = `${VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; SameSite=Lax`;
		return goto(`/calendar?view=${view}&date=${date}`, { keepFocus: true, noScroll: true, replaceState: replace });
	}

	function openBlank(request: CreateRequest) {
		if (!defaultCalendar) return;
		let { startMinutes } = request;
		if (startMinutes === undefined && !request.allDay) {
			// Next whole hour today; 9am on other days.
			const now = zonedParts(Date.now(), data.timeZone);
			startMinutes = request.date === now.date ? Math.min(23 * 60, (now.hour + 1) * 60) : 9 * 60;
		}
		editorError = '';
		draft = blankDraft({ date: request.date, startMinutes, endMinutes: request.endMinutes, allDay: request.allDay, calendarId: defaultCalendar.id, timeZone: data.timeZone, defaultReminder: data.settings?.defaultReminder ?? null });
	}

	function openOccurrence(occurrence: CalendarOccurrence) {
		editorError = '';
		draft = draftFromOccurrence(occurrence, data.timeZone);
	}

	async function refresh() {
		await invalidate('app:calendar');
	}

	async function send(url: string, method: string, body?: unknown) {
		const response = await fetch(url, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});
		await requireOk(response);
		// Mail problems after a saved change (guests not emailed) are reported, not thrown.
		const result = (await response.json().catch(() => ({}))) as { warnings?: string[] };
		for (const warning of result.warnings ?? []) showUndo(warning);
	}

	async function saveChange(occurrence: CalendarOccurrence, input: EventInput): Promise<boolean> {
		let scope: EditScope = 'all';
		// An invitation's calendar and reminders apply to all of it.
		if (occurrence.rrule && !occurrence.myStatus) {
			const chosen = await scopeDialog?.ask({ action: 'edit', allowThis: input.rrule === occurrence.rrule });
			if (!chosen) return false;
			scope = chosen;
		}
		await send(`/api/calendar/events/${encodeURIComponent(occurrence.eventId)}`, 'PATCH', { ...input, scope, occurrenceKey: occurrence.occurrenceKey });
		return true;
	}

	async function save(form: EventDraft) {
		const built = draftToInput(form, data.timeZone);
		if (!built.ok) {
			editorError = built.error;
			return;
		}
		busy = true;
		editorError = '';
		try {
			if (form.occurrence) {
				if (!(await saveChange(form.occurrence, built.input))) return;
			} else {
				await send('/api/calendar/events', 'POST', built.input);
			}
			await refresh();
			draft = null;
		} catch (cause) {
			editorError = requestError(cause);
		} finally {
			busy = false;
		}
	}

	async function remove(form: EventDraft) {
		const occurrence = form.occurrence;
		if (!occurrence) return;
		let query = '';
		if (occurrence.rrule && occurrence.occurrenceKey) {
			const scope = await scopeDialog?.ask({ action: 'delete' });
			if (!scope) return;
			query = `?scope=${scope}&occurrence=${occurrence.occurrenceKey}`;
		}
		busy = true;
		try {
			await send(`/api/calendar/events/${encodeURIComponent(occurrence.eventId)}${query}`, 'DELETE');
			await refresh();
			draft = null;
			showUndo('Event deleted');
		} catch (cause) {
			editorError = requestError(cause);
		} finally {
			busy = false;
		}
	}

	async function respond(form: EventDraft, status: 'accepted' | 'tentative' | 'declined') {
		const occurrence = form.occurrence;
		if (!occurrence) return;
		busy = true;
		editorError = '';
		try {
			await send(`/api/calendar/events/${encodeURIComponent(occurrence.eventId)}/rsvp`, 'POST', { response: status });
			await refresh();
			draft = null;
			if (status === 'declined') showUndo('Declined — removed from your calendar');
		} catch (cause) {
			editorError = requestError(cause);
		} finally {
			busy = false;
		}
	}

	async function move(request: MoveRequest) {
		const o = request.occurrence;
		if (locked(o)) return;
		const input: EventInput = {
			calendarId: o.calendarId,
			title: o.title,
			description: o.description,
			location: o.location,
			allDay: o.allDay,
			start: request.start,
			end: request.end,
			timeZone: o.timeZone,
			rrule: o.rrule,
			attendees: o.attendees.map((guest) => ({ email: guest.email, name: guest.name })),
			reminders: o.reminders
		};
		try {
			if (await saveChange(o, input)) await refresh();
		} catch (cause) {
			showUndo(requestError(cause));
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || document.querySelector('dialog[open], [data-overlay]')) return;
		const key = event.key.toLowerCase();
		const view = VIEW_KEYS[key];
		let handled = true;
		if (view) void show(view, data.date);
		else if (key === 't') void show(data.view, data.today);
		else if (key === 'j' || key === 'n' || event.key === 'ArrowRight') void show(data.view, stepDate(data.view, data.date, 1));
		else if (key === 'k' || key === 'p' || event.key === 'ArrowLeft') void show(data.view, stepDate(data.view, data.date, -1));
		else handled = false;
		if (handled) event.preventDefault();
	}
</script>

<svelte:head><title>{title} · Calendar</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<section class="calendar">
	<header class="phone-head">
		<button type="button" class="phone-btn" aria-label="Open menu" onclick={() => shell?.openNav()}><Icon name="menu-line" size={22} /></button>
		<h1>{phoneTitle}</h1>
		<div class="phone-actions">
			<button type="button" class="phone-btn" aria-label="Today" onclick={() => show(data.view, data.today)}><Icon name="calendar-todo-line" size={20} /></button>
			<select class="phone-view" aria-label="View" value={data.view} onchange={(event) => show(event.currentTarget.value as CalendarView, data.date)}>
				{#each CALENDAR_VIEWS as view (view)}<option value={view}>{VIEW_LABELS[view]}</option>{/each}
			</select>
			{#if $page.data.user && shell}<AccountSwitcher user={$page.data.user} accounts={$page.data.accounts} onLogout={shell.logout} compact />{/if}
		</div>
	</header>

	<header class="bar">
		<button type="button" class="btn-ghost" onclick={() => show(data.view, data.today)} title="Today (T)">Today</button>
		<div class="steps">
			<button type="button" class="icon-btn" aria-label="Previous" title="Previous (K)" onclick={() => show(data.view, stepDate(data.view, data.date, -1))}><Icon name="arrow-left-s-line" size={20} /></button>
			<button type="button" class="icon-btn" aria-label="Next" title="Next (J)" onclick={() => show(data.view, stepDate(data.view, data.date, 1))}><Icon name="arrow-right-s-line" size={20} /></button>
		</div>
		<h1>{title}</h1>
		<div class="views" role="radiogroup" aria-label="View">
			{#each CALENDAR_VIEWS as view (view)}
				<button type="button" role="radio" aria-checked={data.view === view} class:on={data.view === view} title={`${VIEW_LABELS[view]} (${view[0].toUpperCase()})`} onclick={() => show(view, data.date)}>{VIEW_LABELS[view]}</button>
			{/each}
		</div>
	</header>

	{#if data.view === 'day'}
		<div class="phone-steps">
			<button type="button" class="phone-btn" aria-label="Previous day" onclick={() => show('day', stepDate('day', data.date, -1))}><Icon name="arrow-left-s-line" size={20} /></button>
			<span>{viewTitle('day', data.date)}</span>
			<button type="button" class="phone-btn" aria-label="Next day" onclick={() => show('day', stepDate('day', data.date, 1))}><Icon name="arrow-right-s-line" size={20} /></button>
		</div>
	{/if}

	<div class="surface-area">
		{#if data.view === 'month'}
			<MonthGrid from={data.range.from} month={splitDateKey(data.date).month} occurrences={visible} {colors} timeZone={data.timeZone} today={data.today} onOpen={openOccurrence} onCreate={openBlank} onMove={move} onPickDay={(date) => show('day', date)} {locked} />
		{:else if data.view === 'agenda'}
			<AgendaList from={data.range.from} to={data.range.to} occurrences={visible} calendars={data.calendars} timeZone={data.timeZone} today={data.today} onOpen={openOccurrence} onPickDay={(date) => show('day', date)} />
		{:else}
			{#key data.view}
				<TimeGrid {days} occurrences={visible} {colors} timeZone={data.timeZone} today={data.today} onOpen={openOccurrence} onCreate={openBlank} onMove={move} onPickDay={(date) => show('day', date)} {locked} />
			{/key}
		{/if}
	</div>
</section>

<EventEditor {draft} calendars={data.calendars} timeZone={data.timeZone} {busy} error={editorError} defaultReminder={data.settings?.defaultReminder ?? null} onSave={save} onDelete={remove} onRespond={respond} onClose={() => (draft = null)} />
<ScopeDialog bind:this={scopeDialog} />

<style>
	.calendar { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.bar { display: flex; align-items: center; gap: 0.75rem; min-height: 4rem; padding: 0.625rem 1rem 0.5rem 1.25rem; border-bottom: 1px solid var(--color-line); }
	.bar h1 { flex: 1; min-width: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.steps { display: flex; gap: 0.125rem; }
	.views { display: inline-flex; gap: 0.125rem; padding: 0.1875rem; border-radius: 11px; background: var(--color-well); box-shadow: var(--mat-well); }
	.views button { min-height: 1.875rem; padding: 0 0.8rem; border-radius: 8px; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary); }
	.views button:hover { color: var(--color-text); }
	.views button.on { background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-cap); }
	.surface-area { flex: 1; min-height: 0; display: flex; flex-direction: column; }
	.phone-head, .phone-steps { display: none; }

	@media (max-width: 900px) {
		.bar { display: none; }
		.phone-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.5rem; padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem 0.5rem; }
		.phone-head h1 { font-size: 1.6rem; font-weight: 600; letter-spacing: -0.035em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.phone-actions { display: flex; align-items: center; gap: 0.15rem; }
		.phone-btn { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 12px; color: var(--color-text-secondary); }
		.phone-btn:hover { background: var(--color-well); }
		.phone-view { min-height: 2.25rem; padding: 0 0.5rem; border-radius: 10px; font-size: 0.875rem; color: var(--color-text); background: var(--color-well); }
		.phone-steps { display: flex; align-items: center; justify-content: space-between; padding: 0 0.5rem; font-size: 0.875rem; font-weight: 500; color: var(--color-text-secondary); }
	}
</style>

<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { CALENDAR_COLORS, type CalendarInfo } from '$lib/calendar/types';
	import { hiddenCalendars, loadHiddenCalendars, toggleCalendar } from '$lib/calendar/ui-state';
	import { requestError, requireOk } from '$lib/utils/request';
	import Icon from '../Icon.svelte';

	let { calendars, collapsed = false }: { calendars: CalendarInfo[]; collapsed?: boolean } = $props();

	let editing = $state<{ id: string | null; name: string; color: string; url: string } | null>(null);
	let note = $state('');
	let busy = $state(false);
	let error = $state('');
	let confirmDelete = $state(false);

	$effect(() => loadHiddenCalendars());

	function startAdd() {
		error = '';
		confirmDelete = false;
		note = '';
		editing = { id: null, name: '', color: CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length], url: '' };
	}

	function startEdit(calendar: CalendarInfo) {
		error = '';
		confirmDelete = false;
		note = '';
		editing = { id: calendar.id, name: calendar.name, color: calendar.color, url: calendar.source_url ?? '' };
	}

	async function request(url: string, method: string, body?: unknown) {
		busy = true;
		error = '';
		try {
			const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
			await requireOk(response);
			const result = ((await response.json().catch(() => ({}))) as { result?: { added: number; updated: number } }).result;
			await invalidate('app:calendar');
			if (result && editing?.id) note = `Refreshed: ${result.added + result.updated} events.`;
			else editing = null;
		} catch (cause) {
			error = requestError(cause);
		} finally {
			busy = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		if (!editing || busy) return;
		const body = editing.id ? { name: editing.name, color: editing.color } : { name: editing.name, color: editing.color, url: editing.url.trim() || null };
		void (editing.id ? request(`/api/calendar/calendars/${editing.id}`, 'PATCH', body) : request('/api/calendar/calendars', 'POST', body));
	}

	function refreshNow() {
		if (!editing?.id) return;
		void request(`/api/calendar/calendars/${editing.id}`, 'PATCH', { refresh: true });
	}

	function remove() {
		if (!editing?.id) return;
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		void request(`/api/calendar/calendars/${editing.id}`, 'DELETE');
	}
</script>

<div class="cal-list">
	{#if !collapsed}
		<div class="head">
			<p class="section-title">Calendars</p>
			<span class="head-actions">
				<a class="add" href="/settings/calendar" aria-label="Calendar settings" title="Calendar settings"><Icon name="settings-3-line" size={15} /></a>
				<button type="button" class="add" aria-label="Add calendar" title="Add or subscribe to a calendar" onclick={startAdd}><Icon name="add-line" size={16} /></button>
			</span>
		</div>
	{/if}
	<ul>
		{#each calendars as calendar (calendar.id)}
			{@const shown = !$hiddenCalendars.includes(calendar.id)}
			<li class:collapsed>
				<button type="button" class="toggle" aria-pressed={shown} title={collapsed ? calendar.name : `${shown ? 'Hide' : 'Show'} ${calendar.name}`} onclick={() => toggleCalendar(calendar.id)} style="--cal:{calendar.color}">
					<span class="box" class:on={shown}>{#if shown}<Icon name="check-line" size={12} />{/if}</span>
					{#if !collapsed}<span class="name">{calendar.name}</span>{#if calendar.sync_error}<span class="warn" title={calendar.sync_error}><Icon name="error-warning-line" size={13} /></span>{:else if calendar.source_url}<span class="linked" title="Subscribed (read-only)"><Icon name="links-line" size={13} /></span>{/if}{/if}
				</button>
				{#if !collapsed}<button type="button" class="more" aria-label={`Edit ${calendar.name}`} onclick={() => startEdit(calendar)}><Icon name="more-2-fill" size={15} /></button>{/if}
			</li>
		{/each}
	</ul>
	{#if editing && !collapsed}
		<form class="edit" onsubmit={save}>
			<input bind:value={editing.name} placeholder="Calendar name" aria-label="Calendar name" maxlength="60" required />
			{#if !editing.id}
				<input bind:value={editing.url} type="url" inputmode="url" placeholder="Or subscribe: paste a .ics / webcal link" aria-label="Subscribe to a calendar link (optional)" maxlength="2000" />
			{:else if editing.url}
				{@const current = calendars.find((calendar) => calendar.id === editing!.id)}
				<p class="source" title={editing.url}>Subscribed to {editing.url.replace(/^https?:\/\//, '').slice(0, 60)}</p>
				{#if current?.sync_error}<p class="error">Last refresh failed: {current.sync_error}</p>{:else if current?.synced_at}<p class="source">Refreshed {new Date(`${current.synced_at.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>{/if}
				<button type="button" class="refresh" disabled={busy} onclick={refreshNow}><Icon name="refresh-line" size={14} />Refresh now</button>
				{#if note}<p class="source" role="status">{note}</p>{/if}
			{/if}
			<div class="swatches" role="radiogroup" aria-label="Colour">
				{#each CALENDAR_COLORS as color (color)}
					<button type="button" role="radio" aria-checked={editing.color === color} aria-label={color} class:on={editing.color === color} style="--cal:{color}" onclick={() => (editing!.color = color)}></button>
				{/each}
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				{#if editing.id && !calendars.find((calendar) => calendar.id === editing!.id)?.is_default}
					<button type="button" class="delete" disabled={busy} onclick={remove}>{confirmDelete ? 'Delete with its events?' : 'Delete'}</button>
				{/if}
				<span class="spacer"></span>
				<button type="button" class="cancel" onclick={() => (editing = null)}>Cancel</button>
				<button type="submit" class="save" disabled={busy}>{editing.id ? 'Save' : busy && editing.url ? 'Subscribing…' : editing.url.trim() ? 'Subscribe' : 'Add'}</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.cal-list { margin-top: 0.75rem; }
	.head { display: flex; align-items: center; justify-content: space-between; padding-right: 0.25rem; }
	.section-title { padding: 0 0.625rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
	.add, .more { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 8px; color: var(--color-muted); }
	.add:hover, .more:hover { background: var(--color-surface-muted); color: var(--color-text); }
	ul { display: flex; flex-direction: column; gap: 0.125rem; margin-top: 0.25rem; }
	li { display: flex; align-items: center; border-radius: 12px; }
	li:hover { background: var(--color-surface-muted); }
	li .more { opacity: 0; }
	li:hover .more, li .more:focus-visible { opacity: 1; }
	.toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.625rem; height: 2.25rem; padding: 0 0.625rem 0 0.875rem; font-size: 13px; color: var(--color-text-secondary); text-align: left; }
	li.collapsed .toggle { justify-content: center; padding: 0; }
	.box { flex-shrink: 0; display: grid; place-items: center; width: 1rem; height: 1rem; border-radius: 5px; border: 2px solid var(--cal); color: #fff; }
	.box.on { background: var(--cal); }
	.name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.head-actions { display: flex; align-items: center; }
	.linked, .warn { flex-shrink: 0; display: grid; place-items: center; color: var(--color-muted); }
	.warn { color: var(--color-danger); }
	.source { font-size: 0.75rem; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.refresh { align-self: flex-start; display: flex; align-items: center; gap: 0.3rem; min-height: 1.9rem; padding: 0 0.55rem; border-radius: 8px; font-size: 0.75rem; font-weight: 500; color: var(--color-text); background: var(--color-surface-muted); }
	.edit { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.35rem 0.25rem 0; padding: 0.6rem; border-radius: 12px; background: var(--color-surface); box-shadow: var(--mat-panel); }
	.edit input { min-height: 2.1rem; padding: 0 0.55rem; border-radius: 8px; font-size: 0.8125rem; background: var(--color-well); color: var(--color-text); outline: none; border: 1px solid transparent; }
	.edit input:focus { border-color: var(--color-focus-line); }
	.swatches { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.swatches button { width: 1.3rem; height: 1.3rem; border-radius: 50%; background: var(--cal); box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 2px transparent; }
	.swatches button.on { box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--cal); }
	.actions { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; }
	.spacer { flex: 1; }
	.actions button { min-height: 1.9rem; padding: 0 0.55rem; border-radius: 8px; font-weight: 500; }
	.cancel { color: var(--color-text-secondary); }
	.save { color: var(--color-on-accent); background: var(--color-accent); }
	.delete { color: var(--color-danger); }
	.cancel:hover, .delete:hover { background: var(--color-surface-muted); }
	.error { font-size: 0.75rem; color: var(--color-danger); }
	@media (max-width: 900px) {
		li .more { opacity: 1; }
		.toggle { height: 2.75rem; }
	}
</style>

<script lang="ts">
	import { untrack } from 'svelte';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import CopyButton from '$lib/interior/CopyButton.svelte';
	import { reminderLabel, TIMED_REMINDERS, type CalendarSettings } from '$lib/calendar/types';
	import { minutesLabel } from '$lib/calendar/time';
	import { requestError, requireOk } from '$lib/utils/request';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let settings = $state<CalendarSettings | null>(untrack(() => data.calendarSettings));
	let saving = $state(false);
	let error = $state('');
	let status = $state('');

	const writable = $derived(data.calendars.filter((calendar) => !calendar.source_url));
	let importCalendar = $state(untrack(() => data.calendars.find((calendar) => calendar.is_default)?.id ?? ''));
	let importing = $state(false);
	let importStatus = $state('');
	let importError = $state('');
	let fileInput = $state<HTMLInputElement>();

	async function patch(body: Record<string, unknown>, done = 'Saved') {
		saving = true;
		error = '';
		status = '';
		try {
			const response = await fetch('/api/calendar/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			await requireOk(response);
			settings = ((await response.json()) as { settings: CalendarSettings }).settings;
			status = done;
		} catch (cause) {
			error = requestError(cause);
		} finally {
			saving = false;
		}
	}

	function resetLink() {
		if (confirm('Make a new link? Apps subscribed with the old link stop updating.')) void patch({ feed: 'reset' }, 'New link made');
	}

	function turnOffLink() {
		if (confirm('Turn off the link? Apps subscribed with it stop updating.')) void patch({ feed: 'off' }, 'Link turned off');
	}

	async function importFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		importing = true;
		importError = '';
		importStatus = '';
		try {
			if (file.size > 3 * 1024 * 1024) throw new Error('Choose a file under 3 MB.');
			const ics = await file.text();
			const response = await fetch('/api/calendar/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId: importCalendar, ics }) });
			await requireOk(response);
			const { result } = (await response.json()) as { result: { added: number; updated: number; simplified: number; skipped: number } };
			const parts = [`${result.added} event${result.added === 1 ? '' : 's'} added`];
			if (result.updated) parts.push(`${result.updated} updated`);
			if (result.simplified) parts.push(`${result.simplified} repeating ${result.simplified === 1 ? 'event' : 'events'} kept as a single date`);
			if (result.skipped) parts.push(`${result.skipped} skipped (event limit)`);
			importStatus = `${parts.join(', ')}.`;
		} catch (cause) {
			importError = requestError(cause);
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}

	const hours = Array.from({ length: 24 }, (_, hour) => hour);
</script>

<svelte:head>
	<title>Calendar — Settings</title>
</svelte:head>

<HubShell title="Calendar" backHref="/settings" description="Reminders, a morning agenda, and sharing your calendar with other apps.">
	{#if settings}
		<GroupedPanel title="Reminders" hint="Reminders arrive as notifications on devices where you turned them on, and on your phone through Brrr." flush>
			<SettingRow label="Default reminder" id="cal-default-reminder" description="Added to new events. You can change it on each event.">
				{#snippet control()}
					<select id="cal-default-reminder" class="field" disabled={saving} value={settings!.defaultReminder ?? 'none'} onchange={(event) => patch({ defaultReminder: event.currentTarget.value === 'none' ? null : Number(event.currentTarget.value) })}>
						<option value="none">None</option>
						{#each TIMED_REMINDERS as minutes (minutes)}<option value={minutes}>{reminderLabel(minutes, false)}</option>{/each}
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow label="Daily agenda" id="cal-agenda" description="Each morning, an email in your inbox with the day's events. Skipped on days with nothing planned.">
				{#snippet control()}
					<input id="cal-agenda" class="switch" type="checkbox" role="switch" checked={settings!.agendaEmail} disabled={saving} onchange={(event) => patch({ agendaEmail: event.currentTarget.checked })} />
				{/snippet}
				{#if settings.agendaEmail}
					<label class="inline">
						<span>Arrives at</span>
						<select class="field" disabled={saving} value={settings.agendaHour} onchange={(event) => patch({ agendaHour: Number(event.currentTarget.value) })}>
							{#each hours as hour (hour)}<option value={hour}>{minutesLabel(hour * 60)}</option>{/each}
						</select>
						<span class="zone">{settings.timeZone.replaceAll('_', ' ')}</span>
					</label>
				{/if}
			</SettingRow>
		</GroupedPanel>

		<GroupedPanel title="Subscribe from other apps" hint="A private link that Apple Calendar, Google Calendar or Outlook can subscribe to. They show your events read-only and refresh on their own schedule (Google can take a day)." flush>
			<SettingRow label="Subscribe link" description={settings.feedUrl ? 'Anyone with this link can see your events. Make a new link if it was shared by mistake.' : 'Off. Turn it on to get a link.'}>
				{#snippet control()}
					{#if !settings!.feedUrl}<button type="button" class="btn-primary" disabled={saving} onclick={() => patch({ feed: 'on' }, 'Link ready')}>Turn on</button>{/if}
				{/snippet}
				{#if settings.feedUrl}
					<div class="feed">
						<input class="field mono" readonly value={settings.feedUrl} aria-label="Subscribe link" onfocus={(event) => event.currentTarget.select()} />
						<CopyButton value={settings.feedUrl} />
					</div>
					<div class="feed-actions">
						<a class="text-btn" href={settings.feedUrl.replace(/^https?:/, 'webcal:')}>Open in calendar app</a>
						<button type="button" class="text-btn" disabled={saving} onclick={resetLink}>Make a new link</button>
						<button type="button" class="text-btn danger" disabled={saving} onclick={turnOffLink}>Turn off</button>
					</div>
				{/if}
			</SettingRow>
		</GroupedPanel>

		<GroupedPanel title="Import" hint="Add events from a .ics file, such as an export from Google Calendar or Outlook. Importing the same file again updates those events instead of copying them." flush>
			<SettingRow label="Import into" id="cal-import-target">
				{#snippet control()}
					<select id="cal-import-target" class="field" bind:value={importCalendar}>
						{#each writable as calendar (calendar.id)}<option value={calendar.id}>{calendar.name}</option>{/each}
					</select>
				{/snippet}
				<label class="file">
					<input bind:this={fileInput} type="file" accept=".ics,text/calendar" disabled={importing || !importCalendar} onchange={importFile} />
					<span class="btn-ghost">{importing ? 'Importing…' : 'Choose .ics file'}</span>
				</label>
				{#if importError}<p class="message error" role="alert">{importError}</p>{:else if importStatus}<p class="message" role="status">{importStatus}</p>{/if}
			</SettingRow>
		</GroupedPanel>

		{#if error}<p class="message error" role="alert">{error}</p>{:else if status}<p class="message" role="status">{status}</p>{/if}
	{/if}
</HubShell>

<style>
	.field { min-height: 2.25rem; padding: 0 0.6rem; border-radius: 9px; font-size: 0.8125rem; color: var(--color-text); background: var(--color-well); border: 1px solid transparent; }
	.field:focus { border-color: var(--color-focus-line); outline: none; }
	.mono { flex: 1; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; }
	.inline { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.6rem; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.zone { color: var(--color-muted); }
	.feed { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem; }
	.feed-actions { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin-top: 0.5rem; }
	.text-btn { font-size: 0.8125rem; font-weight: 500; color: var(--color-accent-text); }
	.text-btn:hover { text-decoration: underline; }
	.text-btn.danger { color: var(--color-danger); }
	.file { display: inline-flex; margin-top: 0.6rem; cursor: pointer; }
	.file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
	.file:focus-within span { outline: 2px solid var(--color-focus-line); }
	.message { margin-top: 0.75rem; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.message.error { color: var(--color-danger); }
</style>

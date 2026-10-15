<script lang="ts">
	import { untrack } from 'svelte';
	import GroupedPanel from './hub/GroupedPanel.svelte';
	import SettingRow from './settings/SettingRow.svelte';
	import type { NotificationMode, NotificationPrefs } from '$lib/notification-rules';

	let { initial }: { initial: NotificationPrefs } = $props();

	// The form starts from the saved values and then owns its own state.
	let prefs = $state<NotificationPrefs>(untrack(() => structuredClone($state.snapshot(initial)) as NotificationPrefs));
	let vipText = $state(untrack(() => initial.vips.join('\n')));
	let saving = $state(false);
	let status = $state('');
	let error = $state('');

	const modes: { id: NotificationMode; label: string; hint: string }[] = [
		{ id: 'all', label: 'All mail', hint: 'Every new message.' },
		{ id: 'people', label: 'People', hint: 'Skips newsletters, mailing lists and automated senders.' },
		{ id: 'vip', label: 'VIPs only', hint: 'Only the senders listed below.' }
	];
	const modeHint = $derived(modes.find((mode) => mode.id === prefs.mode)?.hint ?? '');

	const timeZones: string[] = (() => {
		try {
			return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
		} catch {
			return ['UTC'];
		}
	})();

	async function save(next: NotificationPrefs) {
		prefs = next;
		saving = true;
		error = '';
		status = '';
		try {
			const res = await fetch('/api/settings/notifications', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(next)
			});
			const body = (await res.json()) as NotificationPrefs & { error?: string };
			if (!res.ok) throw new Error(body.error ?? 'Could not save');
			prefs = body;
			vipText = body.vips.join('\n');
			status = 'Saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save';
		} finally {
			saving = false;
		}
	}

	function setQuiet(partial: Partial<NotificationPrefs['quiet']>) {
		void save({ ...prefs, quiet: { ...prefs.quiet, ...partial } });
	}

	function enableQuiet(on: boolean) {
		// Start from this device's zone the first time.
		const tz = prefs.quiet.tz === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : prefs.quiet.tz;
		setQuiet({ enabled: on, tz });
	}

	function toTime(minutes: number): string {
		return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	}

	function fromTime(value: string): number {
		const [h, m] = value.split(':').map(Number);
		return (h || 0) * 60 + (m || 0);
	}

	function saveVips() {
		const next = vipText.split(/[\s,;]+/).filter(Boolean);
		if (next.join('\n') === prefs.vips.join('\n')) return;
		void save({ ...prefs, vips: next });
	}
</script>

<GroupedPanel
	title="Which mail notifies you"
	hint="Applies to browser, home-screen app and phone (Brrr) notifications."
	flush
>
	<SettingRow label="Notify me about" description={modeHint}>
		{#snippet control()}
			<div class="segmented" role="radiogroup" aria-label="Notify me about">
				{#each modes as mode (mode.id)}
					<button
						type="button"
						role="radio"
						aria-checked={prefs.mode === mode.id}
						disabled={saving}
						onclick={() => save({ ...prefs, mode: mode.id })}
					>
						{mode.label}
					</button>
				{/each}
			</div>
		{/snippet}
	</SettingRow>

	<SettingRow
		label="VIP senders"
		id="notify-vips"
		description="Always notify, even during quiet hours. One address or domain per line, like dana@client.com or client.com."
	>
		<textarea
			id="notify-vips"
			class="vip-input"
			rows="3"
			placeholder={'dana@client.com\nclient.com'}
			bind:value={vipText}
			onblur={saveVips}
		></textarea>
	</SettingRow>

	<SettingRow
		label="Show message preview"
		id="notify-preview"
		description="Adds the first line of the email under the subject. Notifications can show on your lock screen."
	>
		{#snippet control()}
			<input
				id="notify-preview"
				class="switch"
				type="checkbox"
				role="switch"
				checked={prefs.preview}
				disabled={saving}
				onchange={(event) => save({ ...prefs, preview: event.currentTarget.checked })}
			/>
		{/snippet}
	</SettingRow>

	<SettingRow label="Quiet hours" id="notify-quiet" description="Hold notifications overnight. VIPs still get through.">
		{#snippet control()}
			<input
				id="notify-quiet"
				class="switch"
				type="checkbox"
				role="switch"
				checked={prefs.quiet.enabled}
				disabled={saving}
				onchange={(event) => enableQuiet(event.currentTarget.checked)}
			/>
		{/snippet}
		{#if prefs.quiet.enabled}
			<div class="quiet-grid">
				<label>
					<span>From</span>
					<input class="field" type="time" step="900" value={toTime(prefs.quiet.start)} onchange={(event) => setQuiet({ start: fromTime(event.currentTarget.value) })} />
				</label>
				<label>
					<span>Until</span>
					<input class="field" type="time" step="900" value={toTime(prefs.quiet.end)} onchange={(event) => setQuiet({ end: fromTime(event.currentTarget.value) })} />
				</label>
				<label class="wide">
					<span>Time zone</span>
					<select class="field" value={prefs.quiet.tz} onchange={(event) => setQuiet({ tz: event.currentTarget.value })}>
						{#each timeZones as zone (zone)}<option value={zone}>{zone.replaceAll('_', ' ')}</option>{/each}
					</select>
				</label>
			</div>
		{/if}
	</SettingRow>
</GroupedPanel>
{#if error}<p class="message error" role="alert">{error}</p>{:else if status}<p class="message" role="status">{status}</p>{/if}

<style>
	.segmented {
		display: inline-flex;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 0.65rem;
		background: var(--color-well);
	}

	.segmented button {
		height: 1.9rem;
		padding: 0 0.7rem;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.segmented button[aria-checked='true'] {
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: 500;
		box-shadow: var(--shadow-xs);
	}

	.vip-input,
	.field {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.7rem;
		border-radius: 0.6rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.vip-input {
		resize: vertical;
		min-height: 4.5rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8125rem;
	}

	.vip-input:focus,
	.field:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.quiet-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem 0.75rem;
	}

	.quiet-grid label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.quiet-grid .wide {
		grid-column: 1 / -1;
	}

	.message {
		margin: 0.625rem 0.25rem 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.message.error {
		color: var(--color-danger);
	}

	@media (max-width: 560px) {
		.segmented button {
			padding: 0 0.5rem;
		}
	}
</style>

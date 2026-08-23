<script lang="ts">
	import { SNOOZE_PRESETS, toSqliteDatetime, type SnoozePreset } from '$lib/snooze';

	let {
		onPick,
		onClose
	}: {
		onPick: (until: string) => void;
		onClose: () => void;
	} = $props();

	let custom = $state(false);
	let customValue = $state('');

	function pick(preset: SnoozePreset) {
		if (preset.id === 'custom') {
			custom = true;
			return;
		}
		const at = preset.at(new Date());
		if (at) onPick(toSqliteDatetime(at));
	}

	function submitCustom() {
		if (!customValue) return;
		const at = new Date(customValue);
		if (Number.isNaN(at.getTime())) return;
		onPick(toSqliteDatetime(at));
	}
</script>

<div class="menu" data-overlay role="menu">
	{#if custom}
		<label class="custom">
			<span>Wake at</span>
			<input type="datetime-local" bind:value={customValue} />
		</label>
		<button type="button" class="menu-item" onclick={submitCustom}>Snooze</button>
		<button type="button" class="menu-item" onclick={() => (custom = false)}>Back</button>
	{:else}
		{#each SNOOZE_PRESETS as preset (preset.id)}
			<button type="button" class="menu-item" onclick={() => pick(preset)}>
				<span>{preset.label}</span>
				{#if preset.hint}<span class="hint">{preset.hint}</span>{/if}
			</button>
		{/each}
	{/if}
</div>

<style>
	.menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		z-index: 40;
		min-width: 13rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 14px;
		box-shadow: var(--mat-float);
	}

	.menu-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
	}

	.menu-item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.hint {
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.custom {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.custom input {
		padding: 0.375rem 0.5rem;
		border-radius: 8px;
		background: var(--color-well);
		color: var(--color-text);
		box-shadow: var(--mat-well);
	}
</style>

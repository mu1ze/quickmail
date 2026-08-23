<script lang="ts">
	import Icon from './Icon.svelte';
	import {
		nextThemePreference,
		readThemePreference,
		setThemePreference,
		THEME_CHANGE_EVENT,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	let preference = $state<ThemePreference>('system');

	$effect(() => {
		preference = readThemePreference();
		const sync = () => {
			preference = readThemePreference();
		};
		window.addEventListener(THEME_CHANGE_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
	});

	const current = $derived(
		THEME_OPTIONS.find((option) => option.value === preference) ?? THEME_OPTIONS[2]
	);

	function choose(next: ThemePreference) {
		preference = next;
		setThemePreference(next);
	}

	function cycle() {
		choose(nextThemePreference(preference));
	}
</script>

{#if collapsed}
	<button
		type="button"
		class="theme-cycle"
		title="Theme: {current.label}. Click to switch."
		aria-label="Theme: {current.label}. Click to switch."
		onclick={cycle}
	>
		<Icon name={current.icon} size={16} />
	</button>
{:else}
	<div class="theme-switch" role="radiogroup" aria-label="Appearance">
		{#each THEME_OPTIONS as option (option.value)}
			<button
				type="button"
				role="radio"
				aria-checked={preference === option.value}
				class="theme-opt"
				class:selected={preference === option.value}
				title={option.label}
				onclick={() => choose(option.value)}
			>
				<Icon name={option.icon} size={15} />
				<span class="opt-label">{option.label}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.theme-switch {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		flex: 1;
		min-width: 0;
		padding: 0.1875rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
	}

	.theme-opt {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		height: 2.5rem;
		border-radius: 0.5625rem;
		color: var(--color-muted);
		transition: background 0.15s, color 0.15s, box-shadow 0.15s;
	}

	.theme-opt:hover {
		color: var(--color-text);
	}

	.theme-opt.selected {
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--color-line);
	}

	.opt-label {
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1;
	}

	.theme-cycle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 0.5rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
		transition: background 0.15s, color 0.15s;
	}

	.theme-cycle:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}
</style>

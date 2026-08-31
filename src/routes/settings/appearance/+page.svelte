<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		readThemePreference,
		setThemePreference,
		THEME_CHANGE_EVENT,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme';

	let theme = $state<ThemePreference>('system');
	$effect(() => {
		theme = readThemePreference();
		const sync = () => {
			theme = readThemePreference();
		};
		window.addEventListener(THEME_CHANGE_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
	});

	function chooseTheme(next: ThemePreference) {
		theme = next;
		setThemePreference(next);
	}
</script>

<svelte:head>
	<title>Appearance — Settings</title>
</svelte:head>

<HubShell title="Appearance" backHref="/settings">
	<GroupedPanel hint="Choose how Mail looks on this device.">
		<div class="theme-options" role="radiogroup" aria-label="Theme">
			{#each THEME_OPTIONS as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={theme === option.value}
					class="theme-option"
					class:selected={theme === option.value}
					onclick={() => chooseTheme(option.value)}
				>
					<span class="theme-preview theme-preview-{option.value}">
						<span class="preview-bar"></span>
						<span class="preview-line"></span>
						<span class="preview-line short"></span>
					</span>
					<span class="theme-label">
						<Icon name={option.icon} size={15} />
						{option.label}
					</span>
					{#if theme === option.value}
						<span class="theme-check"><Icon name="check-line" size={14} /></span>
					{/if}
				</button>
			{/each}
		</div>
	</GroupedPanel>
</HubShell>

<style>
	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
	}

	.theme-option {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.625rem;
		border: none;
		border-radius: 0.875rem;
		text-align: left;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.theme-option.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.theme-preview {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.3125rem;
		height: 3.25rem;
		padding: 0.5rem;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.preview-bar {
		width: 60%;
		height: 0.375rem;
		border-radius: 6px;
	}

	.preview-line {
		width: 100%;
		height: 0.25rem;
		border-radius: 6px;
		opacity: 0.55;
	}

	.preview-line.short {
		width: 70%;
	}

	.theme-preview-light {
		background: #f5f5f5;
	}

	.theme-preview-light .preview-bar,
	.theme-preview-light .preview-line {
		background: #0a0a0a;
	}

	.theme-preview-dark {
		background: #17171a;
	}

	.theme-preview-dark .preview-bar,
	.theme-preview-dark .preview-line {
		background: #f4f4f5;
	}

	.theme-preview-system {
		background: linear-gradient(120deg, #f5f5f5 0 50%, #17171a 50% 100%);
	}

	.theme-preview-system .preview-bar,
	.theme-preview-system .preview-line {
		background: linear-gradient(120deg, #0a0a0a 0 50%, #f4f4f5 50% 100%);
	}

	.theme-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.theme-check {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 6px;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	@media (max-width: 640px) {
		.theme-options {
			grid-template-columns: 1fr;
		}
	}
</style>

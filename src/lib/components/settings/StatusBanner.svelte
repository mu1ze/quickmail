<script lang="ts">
	import Icon from '../Icon.svelte';

	let {
		tone = 'warn',
		title,
		actions,
		children
	}: {
		tone?: 'warn' | 'bad' | 'good';
		title: string;
		actions?: import('svelte').Snippet;
		children?: import('svelte').Snippet;
	} = $props();

	const icon = $derived(tone === 'good' ? 'checkbox-circle-line' : tone === 'bad' ? 'error-warning-line' : 'alert-line');
</script>

<div class="banner tone-{tone}" role={tone === 'bad' ? 'alert' : 'status'}>
	<Icon name={icon} size={18} />
	<div class="banner-text">
		<p class="banner-title">{title}</p>
		{#if children}<div class="banner-body">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="banner-actions">{@render actions()}</div>{/if}
</div>

<style>
	.banner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding: 0.875rem 1rem;
		border-radius: 14px;
	}

	.tone-warn {
		color: var(--tone-warn-fg);
		background: var(--tone-warn-bg);
		box-shadow: inset 0 0 0 1px var(--tone-notice-line);
	}

	.tone-bad {
		color: var(--tone-bad-fg);
		background: var(--tone-bad-bg);
	}

	.tone-good {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.banner > :global(i) {
		margin-top: 0.05rem;
	}

	.banner-text {
		flex: 1;
		min-width: 0;
	}

	.banner-title {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.banner-body {
		margin-top: 0.2rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.banner-actions {
		display: flex;
		flex-shrink: 0;
		gap: 0.375rem;
	}
</style>

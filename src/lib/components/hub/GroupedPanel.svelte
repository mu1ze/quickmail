<script lang="ts">
	let {
		title,
		hint,
		flush = false,
		actions,
		children
	}: {
		title?: string;
		hint?: string;
		/** Drop the body padding so setting rows can run edge to edge. */
		flush?: boolean;
		/** Buttons shown beside the title. */
		actions?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	} = $props();
</script>

<section class="panel-section">
	{#if title || hint || actions}
		<header class="panel-head">
			<div class="panel-head-text">
				{#if title}<h2 class="panel-title">{title}</h2>{/if}
				{#if hint}<p class="panel-hint">{hint}</p>{/if}
			</div>
			{#if actions}<div class="panel-actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class="panel" class:flush>
		{@render children()}
	</div>
</section>

<style>
	.panel-section + :global(.panel-section) {
		margin-top: 1.75rem;
	}

	.panel-head {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		margin: 0 0.25rem 0.625rem;
	}

	.panel-head-text {
		flex: 1;
		min-width: 0;
	}

	.panel-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.panel-hint {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.panel-actions {
		display: flex;
		flex-shrink: 0;
		gap: 0.375rem;
	}

	.panel {
		padding: 0.875rem;
		border-radius: 14px;
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}

	.panel.flush {
		padding: 0;
		overflow: hidden;
	}

	@media (min-width: 901px) {
		.panel {
			padding: 1rem 1.125rem;
			border-radius: 16px;
			box-shadow: 0 0 0 1px var(--color-line);
		}

		.panel-head {
			margin-left: 0;
			margin-right: 0;
		}
	}
</style>

<script lang="ts">
	let {
		title,
		hint,
		children
	}: {
		title?: string;
		hint?: string;
		children: import('svelte').Snippet;
	} = $props();
</script>

<section class="panel">
	{#if title}
		<h2 class="panel-title">{title}</h2>
	{/if}
	{#if hint}
		<p class="panel-hint">{hint}</p>
	{/if}
	<div class="panel-body">
		{@render children()}
	</div>
</section>

<style>
	.panel {
		border-radius: 14px;
		overflow: hidden;
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}

	.panel + .panel {
		margin-top: 1.25rem;
	}

	.panel-title {
		padding: 0.875rem 0.875rem 0;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
	}

	.panel-hint {
		padding: 0.375rem 0.875rem 0;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.panel-body {
		padding: 0.875rem;
	}

	.panel-title + .panel-body,
	.panel-hint + .panel-body {
		padding-top: 0.625rem;
	}
</style>

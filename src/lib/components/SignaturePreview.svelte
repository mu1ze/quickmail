<script lang="ts">
	let {
		html,
		empty = 'No signature'
	}: {
		html: string;
		empty?: string;
	} = $props();
</script>

<div class="preview" class:empty={!html}>
	{#if html}
		<!-- Compiled output only: every field is escaped in compileSignature. -->
		{@html html}
	{:else}
		{empty}
	{/if}
</div>

<style>
	.preview {
		padding: 1rem 1.1rem;
		border-radius: 0.85rem;
		background: #ffffff;
		color: #222222;
		box-shadow: inset 0 0 0 1px var(--color-line);
		overflow: auto;
	}

	.preview.empty {
		font-size: 0.8125rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
	}

	.preview :global(a) {
		text-decoration: none;
	}

	.preview :global(img) {
		max-width: 100%;
	}
</style>

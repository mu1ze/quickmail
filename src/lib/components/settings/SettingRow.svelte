<script lang="ts">
	let {
		label,
		description,
		id,
		control,
		children
	}: {
		label: string;
		description?: string;
		/** Id of the control, so the label is tied to it. */
		id?: string;
		/** The switch, button or select on the right. */
		control?: import('svelte').Snippet;
		/** Extra content under the description, such as progress or fine print. */
		children?: import('svelte').Snippet;
	} = $props();
</script>

<div class="setting-row">
	<div class="setting-text">
		{#if id}<label class="setting-label" for={id}>{label}</label>{:else}<span class="setting-label">{label}</span>{/if}
		{#if description}<p class="setting-description">{description}</p>{/if}
		{#if children}<div class="setting-extra">{@render children()}</div>{/if}
	</div>
	{#if control}<div class="setting-control">{@render control()}</div>{/if}
</div>

<style>
	.setting-row {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 0.875rem 1rem;
	}

	.setting-row + :global(.setting-row) {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.setting-text {
		flex: 1;
		min-width: 0;
	}

	.setting-label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.setting-description {
		margin-top: 0.2rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.setting-extra {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.setting-control {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 0.375rem;
	}

	@media (min-width: 901px) {
		.setting-row {
			padding: 0.875rem 1.125rem;
		}
	}

	@media (max-width: 520px) {
		.setting-row:has(.setting-control :global(button:not(.switch))) {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>

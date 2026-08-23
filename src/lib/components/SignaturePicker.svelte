<script lang="ts">
	import type { SavedSignature } from '$lib/email-signature';

	let {
		signatures,
		value = $bindable(''),
		noneLabel = 'None',
		label = 'Signature',
		compact = false,
		disabled = false
	}: {
		signatures: SavedSignature[];
		value?: string;
		noneLabel?: string;
		label?: string;
		compact?: boolean;
		disabled?: boolean;
	} = $props();
</script>

{#if signatures.length > 0}
	<div class="picker" class:compact>
		{#if !compact}
			<span class="picker-label">{label}</span>
		{/if}
		<select class="field-input picker-select" bind:value {disabled} aria-label={label}>
			<option value="">{noneLabel}</option>
			{#each signatures as signature (signature.id)}
				<option value={signature.id}>
					{signature.name}{signature.is_default ? ' · default' : ''}
				</option>
			{/each}
		</select>
	</div>
{/if}

<style>
	.picker {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.picker-label {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.picker-select {
		max-width: 16rem;
		padding: 0.35rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.picker.compact .picker-select {
		max-width: 12rem;
		padding: 0.3rem 0.45rem;
		font-size: 0.75rem;
	}
</style>

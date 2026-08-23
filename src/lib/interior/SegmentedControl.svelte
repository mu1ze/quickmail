<script lang="ts">
	type Item = { value: string; label: string };

	let {
		items,
		value = $bindable(),
		label = 'Options'
	}: {
		items: Item[];
		value: string;
		label?: string;
	} = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
	{#each items as item (item.value)}
		<button
			type="button"
			role="radio"
			class="opt"
			class:on={value === item.value}
			aria-checked={value === item.value}
			onclick={() => (value = item.value)}
		>
			{item.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		gap: 0.125rem;
		padding: 0.1875rem;
		border-radius: 11px;
		background: var(--color-well);
		box-shadow: var(--mat-well);
	}

	.opt {
		position: relative;
		height: 1.75rem;
		padding: 0 0.75rem;
		border-radius: 9px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--color-muted);
		transition: color 0.15s, background 0.15s, box-shadow 0.15s;
	}

	.opt:hover {
		color: var(--color-text);
	}

	.opt.on {
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}
</style>

<script lang="ts">
	import { runUndo, undoToast } from '$lib/undo';

	let toast = $state<{ message: string; undo?: () => void | Promise<void>; undoLabel?: string } | null>(
		null
	);

	undoToast.subscribe((value) => {
		toast = value;
	});
</script>

{#if toast}
	<div class="toast" role="status">
		<span>{toast.message}</span>
		{#if toast.undo}
			<button type="button" onclick={() => runUndo()}>{toast.undoLabel ?? 'Undo'}</button>
		{/if}
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		z-index: 90;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem 0.625rem 1rem;
		transform: translateX(-50%);
		background: var(--color-text);
		color: var(--color-surface);
		border-radius: 12px;
		box-shadow: var(--mat-float);
		font-size: 0.8125rem;
	}

	button {
		padding: 0.25rem 0.5rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
	}

	@media (max-width: 900px) {
		.toast {
			bottom: calc(5rem + env(safe-area-inset-bottom));
		}
	}
</style>

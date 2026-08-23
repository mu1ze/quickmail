<script lang="ts">
	type Status = 'idle' | 'pending' | 'success' | 'error';

	let {
		label = 'Continue',
		pendingLabel = 'Working',
		successLabel = 'Done',
		errorLabel = 'Try again',
		status = 'idle',
		disabled = false,
		type = 'button',
		tone = 'cap',
		onclick
	}: {
		label?: string;
		pendingLabel?: string;
		successLabel?: string;
		errorLabel?: string;
		status?: Status;
		disabled?: boolean;
		type?: 'button' | 'submit';
		tone?: 'cap' | 'accent';
		onclick?: (event: MouseEvent) => void;
	} = $props();

	const pending = $derived(status === 'pending');
	const still = $derived(
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
	);
	const shown = $derived(
		status === 'pending'
			? pendingLabel
			: status === 'success'
				? successLabel
				: status === 'error'
					? errorLabel
					: label
	);
</script>

<button
	{type}
	class="loading-btn"
	class:accent={tone === 'accent'}
	disabled={disabled || pending}
	aria-label={shown}
	aria-busy={pending || undefined}
	onclick={onclick}
>
	<span class="faces" aria-hidden="true">
		<span class="face measure">{label}</span>
		<span class="face measure">{pendingLabel}</span>
		<span class="face measure">{successLabel}</span>
		<span class="face measure">{errorLabel}</span>

		<span class="face" class:on={status === 'idle'}>{label}</span>
		<span class="face pending" class:on={status === 'pending'}>
			<span class="spinner" class:still></span>
			{pendingLabel}
		</span>
		<span class="face success" class:on={status === 'success'}>{successLabel}</span>
		<span class="face error" class:on={status === 'error'}>{errorLabel}</span>
	</span>
</button>

<style>
	.loading-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		padding: 0 0.875rem;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: var(--mat-cap);
		outline: none;
		touch-action: manipulation;
		transition: background 0.15s, box-shadow 0.15s, transform 0.12s;
	}

	.loading-btn:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.loading-btn:active:not(:disabled) {
		transform: translateY(1px);
	}

	.loading-btn:focus-visible {
		box-shadow: var(--mat-cap), 0 0 0 2px var(--color-bezel), 0 0 0 4px var(--color-accent);
	}

	.loading-btn:disabled {
		opacity: 0.5;
	}

	.loading-btn.accent {
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: var(--mat-cap-accent);
	}

	.loading-btn.accent:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.faces {
		display: grid;
		place-items: center;
	}

	.face {
		grid-area: 1 / 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		white-space: nowrap;
		opacity: 0;
		transform: translateY(3px);
		filter: blur(3px);
		transition:
			opacity 0.22s ease,
			transform 0.22s ease,
			filter 0.22s ease;
		pointer-events: none;
	}

	.face.measure {
		visibility: hidden;
		opacity: 1;
		transform: none;
		filter: none;
	}

	.face.on {
		opacity: 1;
		transform: none;
		filter: none;
	}

	.face.success {
		color: var(--tone-good-fg);
	}

	.face.error {
		color: var(--tone-bad-fg);
	}

	.loading-btn.accent .face.pending,
	.loading-btn.accent .face.success,
	.loading-btn.accent .face.error {
		color: inherit;
	}

	.spinner {
		width: 0.75rem;
		height: 0.75rem;
		border: 1.5px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		opacity: 0.7;
		animation: spin 0.85s linear infinite;
	}

	.spinner.still {
		animation: none;
		border-right-color: currentColor;
		opacity: 0.45;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-btn:active:not(:disabled) {
			transform: none;
		}

		.face {
			transition: none;
			transform: none;
			filter: none;
		}
	}
</style>

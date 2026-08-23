<script lang="ts">
	let {
		id,
		label,
		value = $bindable(''),
		type = 'text',
		autocomplete = 'off',
		required = false,
		invalid = false,
		message = '',
		name
	}: {
		id: string;
		label: string;
		value?: string;
		type?: string;
		autocomplete?: string;
		required?: boolean;
		invalid?: boolean;
		message?: string;
		name?: string;
	} = $props();

	let focused = $state(false);
	const floated = $derived(focused || value.trim().length > 0);
</script>

<div class="field" class:invalid class:floated>
	<input
		{id}
		{name}
		{type}
		{autocomplete}
		{required}
		bind:value
		aria-invalid={invalid || undefined}
		aria-describedby={message ? `${id}-msg` : undefined}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
	/>
	<label for={id}>{label}</label>
	{#if message}
		<p id={`${id}-msg`} class="message">{message}</p>
	{/if}
</div>

<style>
	.field {
		position: relative;
	}

	input {
		width: 100%;
		height: 2.5rem;
		padding: 0.9rem 0.75rem 0.35rem;
		border: 2px solid var(--color-line-strong);
		border-radius: 10px;
		font-size: 13px;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: var(--mat-well);
		outline: none;
		transition:
			border-color 0.15s,
			background 0.15s,
			box-shadow 0.15s;
	}

	input:focus {
		border-color: var(--color-accent);
		background: var(--color-surface);
		box-shadow: none;
	}

	.invalid input,
	.invalid input:focus {
		border-color: var(--color-danger);
		background: var(--color-surface);
		box-shadow: none;
	}

	label {
		position: absolute;
		left: 0.7rem;
		top: 0.7rem;
		font-size: 13px;
		color: var(--color-muted);
		pointer-events: none;
		transform-origin: left center;
		transition: transform 0.18s ease, font-size 0.18s ease, color 0.18s ease;
	}

	.floated label {
		transform: translateY(-0.42rem);
		font-size: 10px;
		font-weight: 500;
	}

	input:focus + label {
		color: var(--color-accent-text);
	}

	.message {
		min-height: 1.125rem;
		margin-top: 0.25rem;
		font-size: 12px;
		color: var(--color-danger);
	}

	@media (prefers-reduced-motion: reduce) {
		label,
		input {
			transition: none;
		}
	}
</style>

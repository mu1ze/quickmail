<script lang="ts">
	let {
		value,
		label = 'Copy',
		copiedLabel = 'Copied'
	}: {
		value: string;
		label?: string;
		copiedLabel?: string;
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function copy() {
		if (copied) return;
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			copied = false;
		}
	}
</script>

<button type="button" class="copy" aria-label={copied ? copiedLabel : label} onclick={copy}>
	<span class="faces" aria-hidden="true">
		<span class="face measure">{label}</span>
		<span class="face measure">{copiedLabel}</span>
		<span class="face" class:on={!copied}>{label}</span>
		<span class="face ok" class:on={copied}>{copiedLabel}</span>
	</span>
</button>

<style>
	.copy {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		padding: 0 0.75rem;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: var(--color-surface);
		box-shadow: var(--mat-cap);
		outline: none;
	}

	.copy:hover {
		color: var(--color-text);
	}

	.copy:focus-visible {
		box-shadow: var(--mat-cap), 0 0 0 2px var(--color-bezel), 0 0 0 4px var(--color-accent);
	}

	.faces {
		display: grid;
		place-items: center;
	}

	.face {
		grid-area: 1 / 1;
		white-space: nowrap;
		opacity: 0;
		transform: translateY(3px);
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.face.measure {
		visibility: hidden;
		opacity: 1;
		transform: none;
	}

	.face.on {
		opacity: 1;
		transform: none;
	}

	.face.ok {
		color: var(--tone-good-fg);
	}

	@media (prefers-reduced-motion: reduce) {
		.face {
			transition: none;
			transform: none;
		}
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let {
		title,
		backHref = '/inbox',
		backLabel = 'Back',
		children
	}: {
		title: string;
		backHref?: string;
		backLabel?: string;
		children: import('svelte').Snippet;
	} = $props();
</script>

<div class="hub-shell">
	<header class="hub-header">
		<button type="button" class="hub-back" aria-label={backLabel} onclick={() => goto(backHref)}>
			<Icon name="arrow-left-s-line" size={22} />
		</button>
		<h1 class="hub-title">{title}</h1>
		<div class="hub-header-spacer" aria-hidden="true"></div>
	</header>

	<div class="hub-content">
		{@render children()}
	</div>
</div>

<style>
	.hub-shell {
		display: flex;
		flex-direction: column;
		min-height: 100%;
		background: var(--color-well);
	}

	.hub-header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: max(0.625rem, env(safe-area-inset-top)) 0.875rem 0.625rem;
		background: var(--color-surface);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.hub-back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 999px;
		color: var(--color-text);
		background: transparent;
	}

	.hub-title {
		min-width: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		text-align: center;
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.hub-header-spacer {
		width: 2.25rem;
	}

	.hub-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1rem 0.875rem calc(1rem + 4.75rem + env(safe-area-inset-bottom));
	}

	@media (min-width: 901px) {
		.hub-shell {
			min-height: auto;
			background: transparent;
		}

		.hub-header {
			padding-top: 0;
			border-radius: 14px 14px 0 0;
		}

		.hub-content {
			padding: 1rem 1.25rem 1.5rem;
			background: var(--color-surface);
			border-radius: 0 0 14px 14px;
			box-shadow: var(--mat-panel);
		}

		.hub-shell :global(.hub-header) {
			box-shadow: none;
		}
	}
</style>

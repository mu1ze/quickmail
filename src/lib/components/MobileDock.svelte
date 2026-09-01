<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';

	let {
		menuOpen = false,
		onOpenMenu,
		onSearch,
		hideSearch = false
	}: {
		menuOpen?: boolean;
		onOpenMenu: () => void;
		onSearch: () => void;
		hideSearch?: boolean;
	} = $props();

	const composing = $derived($page.url.pathname.startsWith('/compose'));
</script>

{#if !composing}
	<nav class="dock" aria-label="Primary">
		<div class="dock-pill">
			<button
				type="button"
				class="dock-btn"
				class:active={menuOpen}
				aria-label="Open menu"
				aria-expanded={menuOpen}
				onclick={onOpenMenu}
			>
				<Icon name="menu-line" size={20} />
			</button>

			{#if !hideSearch}
				<button type="button" class="dock-search" aria-label="Search messages" onclick={onSearch}>
					<Icon name="search-line" size={18} />
					<span class="dock-search-label">Search</span>
				</button>
			{/if}

			<a href="/compose" class="dock-btn dock-compose" aria-label="New message">
				<Icon name="edit-line" size={20} />
			</a>
		</div>
	</nav>
{/if}

<style>
	.dock {
		display: none;
	}

	@media (max-width: 900px) {
		.dock {
			position: fixed;
			right: 0.75rem;
			bottom: calc(0.625rem + env(safe-area-inset-bottom));
			left: 0.75rem;
			z-index: 32;
			display: block;
			pointer-events: none;
		}

		.dock-pill {
			display: flex;
			align-items: center;
			gap: 0.375rem;
			padding: 0.375rem;
			border-radius: 999px;
			background: color-mix(in srgb, var(--color-surface) 92%, transparent);
			box-shadow:
				0 0 0 1px rgba(28, 25, 23, 0.06),
				0 8px 32px -8px rgba(24, 22, 20, 0.35);
			backdrop-filter: blur(16px);
			pointer-events: auto;
		}

		:root[data-theme='dark'] .dock-pill {
			box-shadow:
				0 0 0 1px rgba(255, 255, 255, 0.08),
				0 8px 32px -8px rgba(0, 0, 0, 0.55);
		}

		.dock-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			width: 2.75rem;
			height: 2.75rem;
			border: none;
			border-radius: 999px;
			color: var(--color-text-secondary);
			background: transparent;
			cursor: pointer;
			transition: background 0.15s, color 0.15s;
		}

		.dock-btn:hover,
		.dock-btn.active {
			background: var(--color-surface-muted);
			color: var(--color-text);
		}

		.dock-search {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 0.375rem;
			flex: 1;
			min-width: 0;
			height: 2.75rem;
			padding: 0 1rem;
			border: none;
			border-radius: 999px;
			font-size: 1rem;
			color: var(--color-muted);
			background: var(--color-well);
			cursor: pointer;
			transition: background 0.15s;
		}

		.dock-search:hover {
			background: var(--color-surface-muted);
		}

		.dock-search-label {
			font-size: 1.0625rem;
			font-weight: 400;
			letter-spacing: -0.01em;
		}

		.dock-compose {
			color: var(--color-text);
			margin-left: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dock-btn,
		.dock-search {
			transition: none;
		}
	}
</style>

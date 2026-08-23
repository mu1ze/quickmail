<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';

	let {
		inboxUnread = 0,
		menuOpen = false,
		onOpenMenu,
		onSearch
	}: {
		inboxUnread?: number;
		menuOpen?: boolean;
		onOpenMenu: () => void;
		onSearch: () => void;
	} = $props();

	function inboxActive(): boolean {
		return $page.url.pathname === '/inbox' || $page.url.pathname.startsWith('/inbox/');
	}

	function starredActive(): boolean {
		return $page.url.pathname === '/starred' || $page.url.pathname.startsWith('/starred/');
	}
</script>

<nav class="dock" aria-label="Primary">
	<a
		href="/inbox"
		class="dock-item"
		class:active={inboxActive()}
		aria-current={inboxActive() ? 'page' : undefined}
	>
		<span class="dock-icon">
			<Icon name="inbox-line" size={20} />
			{#if inboxUnread > 0}
				<span class="dock-badge">{inboxUnread > 99 ? '99+' : inboxUnread}</span>
			{/if}
		</span>
		<span class="dock-label">Inbox</span>
	</a>

	<a
		href="/starred"
		class="dock-item"
		class:active={starredActive()}
		aria-current={starredActive() ? 'page' : undefined}
	>
		<span class="dock-icon"><Icon name="star-line" size={20} /></span>
		<span class="dock-label">Starred</span>
	</a>

	<a href="/compose" class="compose" aria-label="New message">
		<Icon name="pencil-line" size={20} />
		<span class="compose-label">New</span>
	</a>

	<button type="button" class="dock-item" aria-label="Search messages" onclick={onSearch}>
		<span class="dock-icon"><Icon name="search-line" size={20} /></span>
		<span class="dock-label">Search</span>
	</button>

	<button
		type="button"
		class="dock-item"
		class:active={menuOpen}
		aria-label="Open menu"
		aria-expanded={menuOpen}
		onclick={onOpenMenu}
	>
		<span class="dock-icon"><Icon name="menu-line" size={20} /></span>
		<span class="dock-label">Menu</span>
	</button>
</nav>

<style>
	.dock {
		display: none;
	}

	@media (max-width: 900px) {
		.dock {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 32;
			display: grid;
			grid-template-columns: 1fr 1fr auto 1fr 1fr;
			align-items: end;
			gap: 0.125rem;
			padding: 0.375rem 0.5rem calc(0.375rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			box-shadow: inset 0 1px 0 var(--color-line);
		}
	}

	.dock-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1875rem;
		min-height: 2.75rem;
		padding: 0.25rem 0.125rem;
		border: none;
		border-radius: 0.75rem;
		color: var(--color-muted);
		background: transparent;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.dock-item:hover,
	.dock-item.active {
		color: var(--color-text);
	}

	.dock-item.active {
		background: var(--color-surface-muted);
	}

	.dock-icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
	}

	.dock-badge {
		position: absolute;
		top: -0.35rem;
		right: -0.55rem;
		min-width: 1rem;
		padding: 0.05rem 0.25rem;
		border-radius: 9999px;
		font-size: 0.5625rem;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.dock-label {
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		line-height: 1;
	}

	.compose {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1875rem;
		width: 3.25rem;
		margin: -0.85rem 0.35rem 0;
		padding: 0.45rem 0 0.2rem;
		border-radius: 1.125rem;
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: var(--shadow-sm);
	}

	.compose:hover {
		background: var(--color-accent-hover);
	}

	.compose-label {
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	@media (prefers-reduced-motion: reduce) {
		.dock-item,
		.compose {
			transition: none;
		}
	}
</style>

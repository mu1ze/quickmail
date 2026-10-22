<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import AdvancedSearch from './AdvancedSearch.svelte';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import type { BrowserAccount } from '$lib/account-client';

	let {
		user,
		accounts,
		searchInput = $bindable(null),
		onToggleNav,
		onLogout
	}: {
		user: BrowserAccount;
		accounts: BrowserAccount[];
		searchInput?: HTMLInputElement | null;
		onToggleNav: () => void;
		onLogout: (all?: boolean) => Promise<void>;
	} = $props();

	// Search applies to whichever mailbox is open; anywhere else it lands in Inbox.
	const searchTarget = '/all';

	let query = $state('');
	let advancedOpen = $state(false);

	// Keep the field in step with the URL (back button, cleared search, …).
	$effect(() => {
		query = $page.url.searchParams.get('q') ?? '';
	});


	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const params = new URLSearchParams();
		if (query.trim()) params.set('q', query.trim());
		goto(`${searchTarget}${params.size ? `?${params}` : ''}`, { keepFocus: true });
	}

	function clearSearch() {
		query = '';
		goto(searchTarget, { keepFocus: true });
	}
	function advancedSearch(value: string) {
		query = value;
		void goto(`/all${value ? `?q=${encodeURIComponent(value)}` : ''}`);
	}
</script>

<AdvancedSearch bind:open={advancedOpen} {query} onSearch={advancedSearch} />

<header class="topbar">
	<button type="button" class="nav-toggle" aria-label="Open navigation" onclick={onToggleNav}>
		<Icon name="menu-line" size={18} />
	</button>

	<form class="search" onsubmit={submitSearch} role="search">
		<Icon name="search-line" size={16} />
		<input
			type="search"
			bind:this={searchInput}
			bind:value={query}
			placeholder="Search mail"
			aria-label="Search messages"
			enterkeyhint="search"
		/>
		{#if query}
			<button type="button" class="search-clear" aria-label="Clear search" onclick={clearSearch}>
				<Icon name="close-line" size={15} />
			</button>
		{/if}
		<button type="button" class="search-options" aria-label="Show search options" title="Advanced search" onclick={() => (advancedOpen = true)}><Icon name="equalizer-line" size={19} /></button>
	</form>

	<div class="topbar-actions">
		<a href="/settings" class="icon-btn" aria-label="Settings" title="Settings"><Icon name="settings-3-line" size={20} /></a>
		<AccountSwitcher {user} {accounts} {onLogout} responsive />
	</div>
</header>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: var(--topbar-height);
		padding: 0 1rem;
		background: var(--color-surface);
		box-shadow: none;
	}

	.nav-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		max-width: 42rem;
		height: 2.875rem;
		padding: 0 0.75rem;
		border: 1px solid transparent;
		border-radius: 14px;
		background: var(--color-well);
		color: var(--color-muted);
		box-shadow: none;
		transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
	}

	.search:focus-within {
		border-color: var(--color-accent);
		background: var(--color-surface);
		box-shadow: none;
	}

	.search input {
		flex: 1;
		min-width: 0;
		margin-left: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.search input::placeholder {
		color: var(--color-muted);
	}

	.search input::-webkit-search-cancel-button {
		display: none;
	}

	.search-clear {
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}

	.search-clear:hover {
		color: var(--color-text);
	}
	.search-options { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 8px; margin-left: 0.4rem; color: var(--color-text-secondary); }
	.search-options:hover { background: var(--color-surface-hover); }

	.topbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}

	@media (max-width: 900px) {
		.topbar {
			padding: 0 0.5rem 0 0.375rem;
			height: calc(var(--topbar-height) + env(safe-area-inset-top));
			padding-top: env(safe-area-inset-top);
		}

		.nav-toggle {
			display: flex;
			width: 2.75rem;
			height: 2.75rem;
		}

		.search {
			height: 2.5rem;
			max-width: none;
		}

	}
</style>

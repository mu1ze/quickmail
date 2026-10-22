<script lang="ts">
	import AccountSwitcher from './AccountSwitcher.svelte';
	import type { BrowserAccount } from '$lib/account-client';
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';
	import DomainSwitcher from './DomainSwitcher.svelte';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import LabelManager from './LabelManager.svelte';
	import { tooltip } from '$lib/actions/tooltip';
	import { isHubRoute } from '$lib/shell-chrome';
	import { isSettingsLinkActive, settingsGroups } from '$lib/settings-nav';
	import type { Domain, MailboxCounts, MailLabel } from '$lib/types';

	let {
		user,
		accounts,
		counts,
		labels = [],
		domains,
		activeDomainId,
		isAdmin,
		collapsed = $bindable(false),
		mobileOpen = $bindable(false),
		onLogout
	}: {
		user: BrowserAccount;
		accounts: BrowserAccount[];
		counts: MailboxCounts;
		labels?: MailLabel[];
		domains: Domain[];
		activeDomainId: string | null;
		isAdmin: boolean;
		collapsed?: boolean;
		mobileOpen?: boolean;
		onLogout: (all?: boolean) => Promise<void>;
	} = $props();

	type NavItem = {
		href: string;
		icon: string;
		label: string;
		/** Bold pill (unread) vs. plain total. */
		badge?: number;
		count?: number;
	};

	const mailboxes = $derived<NavItem[]>([
		{ href: '/inbox', icon: 'inbox-line', label: 'Inbox', badge: counts.inbox_unread },
		{ href: '/starred', icon: 'star-line', label: 'Starred', count: counts.starred },
		{ href: '/later', icon: 'time-line', label: 'Snoozed', count: counts.later },
		{ href: '/sent', icon: 'send-plane-line', label: 'Sent' },
		{ href: '/drafts', icon: 'draft-line', label: 'Drafts', count: counts.drafts },
		{ href: '/all', icon: 'mail-line', label: 'All mail' },
		{ href: '/spam', icon: 'spam-2-line', label: 'Spam' },
		{ href: '/trash', icon: 'delete-bin-line', label: 'Trash', count: counts.trash }
	]);

	const tools = $derived<NavItem[]>([
		{ href: '/settings', icon: 'user-settings-line', label: 'Settings' },
		...(isAdmin ? [{ href: '/admin', icon: 'settings-3-line', label: 'Admin' }] : [])
	]);

	function isActive(href: string): boolean {
		if (href === '/all' && $page.url.searchParams.has('label')) return false;
		return $page.url.pathname === href || $page.url.pathname.startsWith(`${href}/`);
	}

	// Phone drawer always shows labels, even if the desktop sidebar is collapsed.
	const expanded = $derived(!collapsed || mobileOpen);

	// Settings and admin take over the sidebar with their own grouped sections.
	const settingsMode = $derived(isHubRoute($page.url.pathname));
	const groups = $derived(settingsGroups(isAdmin));
</script>

{#if mobileOpen}
	<button
		type="button"
		class="scrim"
		aria-label="Close navigation"
		onclick={() => (mobileOpen = false)}
	></button>
{/if}

<aside class="sidebar" class:collapsed class:mobile-open={mobileOpen}>
	<div class="sidebar-top">
		<a href="/inbox" class="brand" title="Mail" onclick={() => (mobileOpen = false)}>
			<Logo size={30} />
			{#if expanded}<span class="brand-name">QuickMail<span class="brand-detail">MAKE ROOM FOR FOCUS</span></span>{/if}
		</a>
		{#if !mobileOpen}
			<button
				type="button"
				class="collapse-btn"
				aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				aria-expanded={!collapsed}
				use:tooltip={collapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
				onclick={() => (collapsed = !collapsed)}
			>
				<Icon name={collapsed ? 'sidebar-unfold-line' : 'sidebar-fold-line'} size={18} />
			</button>
		{/if}
		{#if mobileOpen}
			<button
				type="button"
				class="drawer-close"
				aria-label="Close navigation"
				onclick={() => (mobileOpen = false)}
			>
				<Icon name="close-line" size={18} />
			</button>
		{/if}
	</div>

	<div class="sidebar-account"><AccountSwitcher {user} {accounts} compact={!expanded} {onLogout} /></div>

	{#if settingsMode}
		<a href="/inbox" class="nav-link back-link" title={expanded ? undefined : 'Back to mail'}>
			<Icon name="arrow-left-s-line" size={18} />
			{#if expanded}<span class="nav-label">Back to mail</span>{/if}
		</a>
		{#if expanded}<p class="settings-title">Settings</p>{/if}
		{#each groups as group (group.id)}
			<nav class="nav settings-group" aria-label={group.label}>
				{#if expanded}<p class="section-title">{group.label}</p>{/if}
				{#each group.links as link (link.href)}
					<a
						href={link.href}
						class="nav-link"
						class:active={isSettingsLinkActive(link.href, $page.url.pathname)}
						aria-current={isSettingsLinkActive(link.href, $page.url.pathname) ? 'page' : undefined}
						title={expanded ? undefined : link.label}
					>
						<Icon name={link.icon} size={17} />
						{#if expanded}<span class="nav-label">{link.label}</span>{/if}
					</a>
				{/each}
			</nav>
		{/each}
	{:else}
		<a href="/compose" class="new-message" title="New message" onclick={() => (mobileOpen = false)}>
			<Icon name="pencil-line" size={expanded ? 16 : 18} />
			{#if expanded}<span>Compose</span><kbd>C</kbd>{/if}
		</a>

		<nav class="nav" aria-label="Mailboxes">
			{#each mailboxes as item (item.href)}
				<a
					href={item.href}
					class="nav-link"
					class:active={isActive(item.href)}
					aria-current={isActive(item.href) ? 'page' : undefined}
					title={expanded ? undefined : item.label}
					onclick={() => (mobileOpen = false)}
				>
					<Icon name={item.icon} size={17} />
					{#if expanded}
						<span class="nav-label">{item.label}</span>
						{#if item.badge}
							<span class="nav-badge">{item.badge}</span>
						{:else if item.count}
							<span class="nav-count">{item.count}</span>
						{/if}
					{:else if item.badge}
						<span class="nav-dot"></span>
					{/if}
				</a>
			{/each}
		</nav>

		<!-- On desktop the domain scope lives in the mailbox header; the phone drawer keeps it here. -->
		{#if mobileOpen && domains.length > 1}
			<div class="section">
				<p class="section-title">Domains</p>
				<div class="section-body">
					<DomainSwitcher {domains} {activeDomainId} block />
				</div>
			</div>
		{/if}

		<div class="labels-section">
			<LabelManager {labels} collapsed={!expanded} />
			<nav class="nav" aria-label="Labels">
				{#each labels as label (label.id)}
					<a href={`/all?label=${encodeURIComponent(label.id)}`} class="nav-link" class:active={$page.url.searchParams.get('label') === label.id} aria-current={$page.url.searchParams.get('label') === label.id ? 'page' : undefined} title={label.name} onclick={() => (mobileOpen = false)}><Icon name="price-tag-3-line" size={17} />{#if expanded}<span class="nav-label">{label.name}</span>{/if}</a>
				{/each}
			</nav>
		</div>

		<nav class="nav nav-tools">
			{#each tools as item (item.href)}
				<a
					href={item.href}
					class="nav-link"
					class:active={isActive(item.href)}
					aria-current={isActive(item.href) ? 'page' : undefined}
					title={expanded ? undefined : item.label}
					onclick={() => (mobileOpen = false)}
				>
					<Icon name={item.icon} size={17} />
					{#if expanded}<span class="nav-label">{item.label}</span>{/if}
				</a>
			{/each}

		</nav>
	{/if}

	<div class="sidebar-foot">
		<ThemeSwitcher collapsed={!expanded} />
	</div>
</aside>

<style>
	.sidebar-account { margin-bottom: 0.5rem; }
	.sidebar {
		overflow-y: auto;
		scrollbar-width: none;
		position: relative;
		z-index: 40;
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		width: var(--sidebar-width);
		padding: 0.25rem 0.25rem 0.5rem;
		background: transparent;
		transition: width 0.2s ease, transform 0.22s cubic-bezier(0.23, 1, 0.32, 1);
	}
	.sidebar::-webkit-scrollbar { display: none; }
	.sidebar > * { flex-shrink: 0; }

	/* The rail is just the 2.5rem icon targets with a sliver of margin. */
	.sidebar.collapsed {
		width: var(--sidebar-width-collapsed);
		padding-left: 0.25rem;
		padding-right: 0.25rem;
	}

	.sidebar-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: var(--topbar-height);
		padding: 0 0.25rem 0.75rem 0.75rem;
	}

	.brand-name { display: flex; flex-direction: column; gap: 0.25rem; }
	.brand-detail { white-space: nowrap; font-size: 0.5rem; letter-spacing: 0.14em; font-weight: 500; color: var(--color-muted); }
	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.15rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.new-message {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.7rem;
		height: 3.25rem;
		padding: 0 1.2rem;
		margin-bottom: 1.25rem;
		border-radius: 14px;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: var(--mat-cap-accent);
		transition: background 0.15s;
	}

	.new-message:hover {
		background: var(--color-accent-hover);
	}
	.new-message kbd { margin-left: auto; font-size: 0.625rem; padding: 0.1rem 0.3rem; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; opacity: 0.65; }
	.sidebar.collapsed .new-message { justify-content: center; padding: 0; height: 2.5rem; border-radius: 12px; }

	.nav {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.nav-tools {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}
	.labels-section { margin-top: 1rem; }
	.back-link { color: var(--color-muted); margin-bottom: 0.25rem; }
	.settings-title { padding: 0.5rem 0.875rem 0.25rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; color: var(--color-text); }
	.settings-group { margin-top: 0.875rem; }
	.settings-group .section-title { padding: 0 0.875rem 0.3rem; }

	.nav-link {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		height: 2.5rem;
		padding: 0 0.875rem;
		border-radius: 12px;
		font-size: 13px;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.sidebar.collapsed .nav-link {
		justify-content: center;
		padding: 0;
	}

	.drawer-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		margin: -0.5rem -0.25rem -0.5rem 0;
		border: none;
		border-radius: 0.625rem;
		color: var(--color-text-secondary);
		background: transparent;
	}

	.drawer-close:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.nav-link:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.nav-link.active {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		font-weight: 600;
		box-shadow: none;
	}

	.nav-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-badge {
		min-width: 1.125rem;
		padding: 0.0625rem 0.3125rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		font-weight: 600;
		text-align: center;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.nav-count {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.nav-dot {
		position: absolute;
		top: 0.4375rem;
		right: 0.6875rem;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 3px;
		background: var(--color-accent);
	}

	.section {
		margin-top: 1.125rem;
	}

	.section-title {
		padding: 0 0.625rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-muted);
	}

	.section-body {
		margin-top: 0.375rem;
	}

	.sidebar-foot {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.75rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.sidebar.collapsed .sidebar-foot {
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	/* The rail stacks the logo over the expand button. */
	.sidebar.collapsed .sidebar-top {
		flex-direction: column;
		justify-content: center;
		gap: 0.5rem;
		padding-left: 0;
		padding-right: 0;
	}

	.collapse-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.625rem;
		color: var(--color-muted);
		transition: background 0.15s, color 0.15s;
	}

	.collapse-btn:hover,
	.collapse-btn:focus-visible {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 35;
		background: var(--color-scrim);
	}

	@media (max-width: 900px) {
		.sidebar {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			width: min(20rem, 88vw);
			padding: calc(0.75rem + env(safe-area-inset-top)) 0.75rem
				calc(0.75rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			box-shadow: var(--mat-float);
			transform: translateX(-110%);
			transition: transform 0.22s cubic-bezier(0.23, 1, 0.32, 1);
		}

		.sidebar.collapsed {
			width: min(20.5rem, 88vw);
			padding-left: 0.875rem;
			padding-right: 0.875rem;
		}

		.sidebar.collapsed .nav-link {
			justify-content: flex-start;
			padding: 0 0.625rem;
		}

		.sidebar.collapsed .sidebar-foot {
			flex-direction: row;
			align-items: stretch;
		}

		.sidebar.collapsed .sidebar-top {
			flex-direction: row;
			justify-content: space-between;
			padding: 0 0.75rem 0.75rem;
		}

		.nav-link {
			min-height: 2.75rem;
			height: auto;
			padding: 0.5rem 0.75rem;
		}

		.collapse-btn {
			display: none;
		}

		.sidebar.mobile-open {
			transform: none;
		}

		.scrim {
			display: block;
		}
	}

	@media (min-width: 901px) {
		.scrim {
			display: none;
		}
	}
</style>

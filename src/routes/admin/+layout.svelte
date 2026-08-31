<script lang="ts">
	import { page } from '$app/stores';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedNav, { type HubLink } from '$lib/components/hub/GroupedNav.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const isHub = $derived($page.url.pathname === '/admin');

	const links = $derived.by((): HubLink[] => {
		const items: HubLink[] = [
			{ href: '/admin/domains', label: 'Domains', icon: 'global-line' },
			{ href: '/admin/users', label: 'Users', icon: 'group-line' }
		];
		if (data.unrouted.length > 0) {
			items.push({
				href: '/admin/unrouted',
				label: 'Unrouted',
				icon: 'question-mark',
				detail: String(data.unrouted.length)
			});
		}
		return items;
	});
</script>

<svelte:head>
	<title>Admin — Mail</title>
</svelte:head>

<div class="admin-layout" class:admin-hub={isHub}>
	<aside class="admin-nav" aria-label="Admin sections">
		{#if isHub}
			<HubShell title="Admin" backHref="/inbox" backLabel="Back to mail">
				{#if data.loadError}
					<div class="banner">
						<Icon name="error-warning-line" size={16} />
						<span>{data.loadError}</span>
					</div>
				{/if}
				<GroupedNav {links} footer="Domains, users, and mail routing for this dashboard." />
			</HubShell>
		{:else}
			<div class="admin-nav-inner">
				<p class="admin-nav-title">Admin</p>
				<GroupedNav {links} />
			</div>
		{/if}
	</aside>

	{#if !isHub}
		<div class="admin-detail">
			{#if data.loadError}
				<div class="banner">
					<Icon name="error-warning-line" size={16} />
					<span>{data.loadError}</span>
				</div>
			{/if}
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.admin-layout {
		min-height: 100%;
	}

	.admin-nav-inner {
		display: none;
	}

	.admin-detail {
		min-width: 0;
	}

	.banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.875rem 1.125rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		border-radius: 14px;
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--tone-notice-line), var(--shadow-sm);
	}

	@media (min-width: 901px) {
		.admin-layout {
			display: grid;
			grid-template-columns: 16rem minmax(0, 1fr);
			gap: 1rem;
			max-width: 56rem;
			margin: 0 auto;
			padding: 1rem 1rem 2rem;
		}

		.admin-layout.admin-hub {
			grid-template-columns: 1fr;
			max-width: 28rem;
		}

		.admin-nav-inner {
			display: block;
			position: sticky;
			top: 0;
			align-self: start;
		}

		.admin-nav-title {
			margin-bottom: 0.75rem;
			padding-left: 0.25rem;
			font-size: 1.25rem;
			font-weight: 700;
			letter-spacing: -0.02em;
		}

		.admin-layout.admin-hub .admin-nav-inner {
			display: none;
		}

		.admin-layout:not(.admin-hub) .admin-nav :global(.hub-shell) {
			display: none;
		}

		.admin-layout:not(.admin-hub) .admin-detail .banner {
			margin-bottom: 0;
		}
	}
</style>

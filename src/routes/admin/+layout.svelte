<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedNav, { type HubLink } from '$lib/components/hub/GroupedNav.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const isHub = $derived($page.url.pathname === '/admin');

	// Wide screens list admin sections in the sidebar, so skip the hub there.
	$effect(() => {
		if (isHub && matchMedia('(min-width: 901px)').matches) void goto('/admin/users', { replaceState: true });
	});

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
	{#if isHub}
		<aside class="admin-nav" aria-label="Admin sections">
			<HubShell title="Admin" backHref="/inbox" backLabel="Back to mail">
				{#if data.loadError}
					<div class="banner">
						<Icon name="error-warning-line" size={16} />
						<span>{data.loadError}</span>
					</div>
				{/if}
				<GroupedNav {links} footer="Domains, users, and mail routing for this dashboard." />
			</HubShell>
		</aside>
	{:else}
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
			max-width: 50rem;
			padding: 1.75rem 2.5rem 3rem;
		}

		.admin-layout:not(.admin-hub) .admin-detail .banner {
			margin-bottom: 1.5rem;
		}
	}
</style>

<script lang="ts">
	import { page } from '$app/stores';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedNav, { type HubLink } from '$lib/components/hub/GroupedNav.svelte';

	let { children }: { children: import('svelte').Snippet } = $props();

	const isHub = $derived($page.url.pathname === '/settings');

	const links: HubLink[] = [
		{ href: '/settings/appearance', label: 'Appearance', icon: 'contrast-2-line' },
		{ href: '/settings/password', label: 'Password', icon: 'lock-password-line' },
		{ href: '/settings/notifications', label: 'Notifications', icon: 'notification-3-line' },
		{ href: '/settings/signatures', label: 'Signatures', icon: 'pencil-line' },
		{ href: '/settings/addresses', label: 'Addresses', icon: 'at-line' },
		{ href: '/settings/domains', label: 'Connected domains', icon: 'global-line' },
		{ href: '/settings/api-keys', label: 'API keys', icon: 'key-2-line' }
	];
</script>

<div class="settings-layout" class:settings-hub={isHub}>
	<aside class="settings-nav" aria-label="Settings sections">
		{#if isHub}
			<HubShell title="Settings" backHref="/inbox" backLabel="Back to mail">
				<GroupedNav {links} footer="Account, sending identity, and integrations." />
			</HubShell>
		{:else}
			<div class="settings-nav-inner">
				<p class="settings-nav-title">Settings</p>
				<GroupedNav {links} />
			</div>
		{/if}
	</aside>

	{#if !isHub}
		<div class="settings-detail">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.settings-layout {
		min-height: 100%;
	}

	.settings-nav-inner {
		display: none;
	}

	.settings-detail {
		min-width: 0;
	}

	@media (min-width: 901px) {
		.settings-layout {
			display: grid;
			grid-template-columns: 16rem minmax(0, 1fr);
			gap: 1rem;
			max-width: 56rem;
			margin: 0 auto;
			padding: 1rem 1rem 2rem;
		}

		.settings-layout.settings-hub {
			grid-template-columns: 1fr;
			max-width: 28rem;
		}

		.settings-nav-inner {
			display: block;
			position: sticky;
			top: 0;
			align-self: start;
		}

		.settings-nav-title {
			margin-bottom: 0.75rem;
			padding-left: 0.25rem;
			font-size: 1.25rem;
			font-weight: 700;
			letter-spacing: -0.02em;
		}

		.settings-layout.settings-hub .settings-nav-inner {
			display: none;
		}

		.settings-layout:not(.settings-hub) .settings-nav :global(.hub-shell) {
			display: none;
		}
	}

	.settings-layout:not(.settings-hub) .settings-nav {
		display: none;
	}

	@media (min-width: 901px) {
		.settings-layout:not(.settings-hub) .settings-nav {
			display: block;
		}
	}
</style>

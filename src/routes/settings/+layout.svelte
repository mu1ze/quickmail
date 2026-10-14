<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedNav, { type HubLink } from '$lib/components/hub/GroupedNav.svelte';
	import { FIRST_SETTINGS_HREF, settingsGroups } from '$lib/settings-nav';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const isHub = $derived($page.url.pathname === '/settings');

	// The sidebar lists every section on wide screens, so the hub would only repeat it.
	$effect(() => {
		if (isHub && matchMedia('(min-width: 901px)').matches) void goto(FIRST_SETTINGS_HREF, { replaceState: true });
	});

	/** A quick read of each section's state, shown beside it in the phone list. */
	function detail(href: string): string | undefined {
		switch (href) {
			case '/settings/addresses':
				return String(data.addresses.length);
			case '/settings/signatures':
				return data.signatures.length ? String(data.signatures.length) : 'None';
			case '/settings/notifications':
				return data.brrr.configured ? 'Phone on' : undefined;
			case '/settings/api-keys':
				return data.apiTokens.length ? String(data.apiTokens.length) : 'None';
			default:
				return undefined;
		}
	}

	const groups = $derived(
		settingsGroups(data.isAdmin).map((group) => ({
			...group,
			links: group.links.map((link): HubLink => ({ ...link, detail: detail(link.href) }))
		}))
	);
</script>

<svelte:head>
	{#if isHub}<title>Settings — Mail</title>{/if}
</svelte:head>

{#if isHub}
	<div class="settings-hub">
		<HubShell title="Settings" backHref="/inbox" backLabel="Back to mail">
			{#each groups as group (group.id)}
				<GroupedNav title={group.label} links={group.links} />
			{/each}
		</HubShell>
	</div>
{:else}
	<div class="settings-detail">
		{@render children()}
	</div>
{/if}

<style>
	.settings-hub,
	.settings-detail {
		min-height: 100%;
		min-width: 0;
	}

	@media (min-width: 901px) {
		.settings-detail {
			max-width: 50rem;
			padding: 1.75rem 2.5rem 3rem;
		}

		/* The signature editor sits beside its live preview, so give it more room. */
		.settings-detail:has(:global(.editor:not(.compact))) {
			max-width: 76rem;
		}
	}
</style>

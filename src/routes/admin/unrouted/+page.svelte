<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();
</script>

<svelte:head>
	<title>Unrouted mail — Admin</title>
</svelte:head>

<HubShell title="Unrouted mail" backHref="/admin">
	<GroupedPanel hint="No matching address or catch-all.">
		{#if data.unrouted.length > 0}
			<ul class="mail-list">
				{#each data.unrouted as item (item.id)}
					<li class="mail-row">
						<div class="min-w-0 flex-1">
							<p class="mail-subject">{item.subject || '(no subject)'}</p>
							<p class="mail-route">{item.from_addr} → {item.to_addr}</p>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">No unrouted mail right now.</p>
		{/if}
	</GroupedPanel>
</HubShell>

<style>
	.mail-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mail-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
	}

	.mail-row + .mail-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.mail-subject {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.mail-route {
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}
</style>

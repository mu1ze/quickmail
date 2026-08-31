<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();
</script>

<svelte:head>
	<title>Connected domains — Settings</title>
</svelte:head>

<HubShell title="Connected domains" backHref="/settings">
	<GroupedPanel hint="Domains linked to your account and what each can do.">
		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-row">
					<span class="domain-name">{domain.name}</span>
					<span class="caps">
						<span
							class="chip"
							class:chip-on={domain.sending_enabled &&
								data.domainPermissions[domain.id]?.can_send !== false}>send</span
						>
						<span
							class="chip"
							class:chip-on={domain.receiving_enabled &&
								data.domainPermissions[domain.id]?.can_receive !== false}>receive</span
						>
						<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
					</span>
				</li>
			{/each}
		</ul>
	</GroupedPanel>
</HubShell>

<style>
	.domain-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.domain-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0;
	}

	.domain-row + .domain-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.domain-name {
		font-size: 0.9375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.caps {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-well);
	}

	.chip-on {
		color: var(--color-text-secondary);
	}

	.chip-ok {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}
</style>

<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let connecting = $state<string | null>(null);
	let domainError = $state('');

	const connectable = $derived(data.available.filter((domain) => !domain.connected));

	function addressesFor(domainId: string) {
		return data.addresses.filter((address) => address.domain_id === domainId);
	}

	function userLabel(userId: string | null) {
		if (!userId) return 'Nobody (unrouted mail is held)';
		const match = data.users.find((user) => user.id === userId);
		return match ? `${match.name} (${match.email})` : 'Unknown user';
	}

	async function connect(domainId: string) {
		connecting = domainId;
		domainError = '';

		try {
			const res = await fetch('/api/domains', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId })
			});
			const body = await res.json();
			if (!res.ok) {
				domainError = body.error ?? 'Could not connect that domain';
				return;
			}
			window.location.reload();
		} catch {
			domainError = 'Network error';
		} finally {
			connecting = null;
		}
	}

	async function updateDomain(domainId: string, patch: Record<string, unknown>) {
		domainError = '';
		const res = await fetch(`/api/domains/${domainId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		const body = await res.json();
		if (!res.ok) {
			domainError = body.error ?? 'Update failed';
			return;
		}
		window.location.reload();
	}

	async function disconnect(domainId: string, domainName: string) {
		if (!confirm(`Stop using ${domainName} in this dashboard? Mail already received is kept.`)) {
			return;
		}

		const res = await fetch(`/api/domains/${domainId}`, { method: 'DELETE' });
		if (res.ok) window.location.reload();
	}
</script>

<svelte:head>
	<title>Domains — Admin</title>
</svelte:head>

<HubShell title="Domains" backHref="/admin">
	<GroupedPanel hint="Catch-all gets unmatched mail.">
		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-item">
					<div class="domain-head">
						<div class="min-w-0">
							<p class="domain-name">{domain.name}</p>
							<p class="domain-sub">
								{addressesFor(domain.id).length} address{addressesFor(domain.id).length === 1
									? ''
									: 'es'}
								{#if domain.region}· {domain.region}{/if}
							</p>
						</div>
						<div class="chips">
							<span class="chip" class:chip-on={domain.sending_enabled}>send</span>
							<span class="chip" class:chip-on={domain.receiving_enabled}>receive</span>
							<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
						</div>
					</div>

					<div class="domain-controls">
						<label class="control">
							<span class="control-label">Catch-all</span>
							<select
								value={domain.catchall_user_id ?? ''}
								onchange={(event) =>
									updateDomain(domain.id, {
										catchallUserId: (event.currentTarget as HTMLSelectElement).value || null
									})}
							>
								<option value="">Nobody (hold as unrouted)</option>
								{#each data.users as user (user.id)}
									<option value={user.id}>{user.name} — {user.email}</option>
								{/each}
							</select>
						</label>

						<div class="control-actions">
							<button
								type="button"
								class="btn-ghost text-xs"
								onclick={() => updateDomain(domain.id, { refresh: true })}
							>
								<Icon name="refresh-line" size={14} /> Re-sync
							</button>
							<button
								type="button"
								class="btn-ghost text-xs"
								onclick={() => disconnect(domain.id, domain.name)}
							>
								Disconnect
							</button>
						</div>
					</div>

					{#if !domain.receiving_enabled}
						<p class="hint">
							<Icon name="information-line" size={13} />
							Inbound is off
							{data.providerKind === 'cloudflare'
								? '— point Email Routing’s catch-all at this Worker'
								: '— add the MX record'}
							to receive.
						</p>
					{/if}
					{#if domain.catchall_user_id}
						<p class="hint">
							<Icon name="user-received-line" size={13} />
							Goes to {userLabel(domain.catchall_user_id)}.
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	</GroupedPanel>

	{#if connectable.length > 0}
		<GroupedPanel
			title="Available"
			hint="In {data.providerKind === 'cloudflare' ? 'Cloudflare Email' : 'Resend'}."
		>
			<ul class="connect-list">
				{#each connectable as domain (domain.id)}
					<li class="connect-row">
						<div class="min-w-0">
							<p class="domain-name">{domain.name}</p>
							<p class="domain-sub">{domain.status}{#if domain.region} · {domain.region}{/if}</p>
						</div>
						<button
							type="button"
							class="btn-primary text-xs"
							disabled={connecting === domain.id}
							onclick={() => connect(domain.id)}
						>
							{connecting === domain.id ? 'Connecting…' : 'Connect'}
						</button>
					</li>
				{/each}
			</ul>
		</GroupedPanel>
	{/if}

	{#if domainError}<p class="error">{domainError}</p>{/if}
</HubShell>

<style>
	.domain-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.domain-item {
		padding: 0.75rem 0;
	}

	.domain-item + .domain-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.domain-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.domain-name {
		font-size: 0.9375rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.domain-sub {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.chips {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
	}

	.chip-on {
		color: var(--color-text-secondary);
	}

	.chip-ok {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.domain-controls {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.875rem;
	}

	.control {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.control-label {
		font-size: 0.6875rem;
		color: var(--color-muted);
	}

	.control select {
		max-width: 100%;
		padding: 0.4375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		outline: none;
		cursor: pointer;
	}

	.control-actions {
		display: flex;
		gap: 0.25rem;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.connect-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.connect-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.connect-row + .connect-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 640px) {
		.control-actions {
			flex-wrap: wrap;
		}
	}
</style>

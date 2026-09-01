<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import Check from '$lib/components/Check.svelte';
	import type { DomainPermissionFlags } from '$lib/types';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let localPart = $state('');
	let newUserDomainId = $state('');
	let name = $state('');
	let password = $state('');

	$effect(() => {
		if (!newUserDomainId && data.domains[0]) {
			newUserDomainId = data.domains[0].id;
		}
	});

	let userError = $state('');
	let creatingUser = $state(false);
	let permError = $state('');
	let permBusy = $state('');
	let domainPermissions = $state<Record<string, Record<string, DomainPermissionFlags>>>({});
	let permsHydrated = $state(false);

	$effect(() => {
		if (!permsHydrated) {
			domainPermissions = data.domainPermissions;
			permsHydrated = true;
		}
	});

	const FULL_FLAGS: DomainPermissionFlags = {
		can_send: true,
		can_receive: true,
		can_create_address: true
	};

	async function createUser(event: SubmitEvent) {
		event.preventDefault();
		userError = '';
		creatingUser = true;

		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, localPart, domainId: newUserDomainId, password })
			});
			const body = await res.json();
			if (!res.ok) {
				userError = body.error ?? 'Failed to create user';
				return;
			}
			window.location.reload();
		} catch {
			userError = 'Network error';
		} finally {
			creatingUser = false;
		}
	}

	function flagsFor(userId: string, domainId: string): DomainPermissionFlags {
		return domainPermissions[userId]?.[domainId] ?? FULL_FLAGS;
	}

	async function setDomainFlag(
		userId: string,
		domainId: string,
		key: keyof DomainPermissionFlags,
		value: boolean
	) {
		const next = { ...flagsFor(userId, domainId), [key]: value };
		domainPermissions = {
			...domainPermissions,
			[userId]: { ...domainPermissions[userId], [domainId]: next }
		};

		permBusy = `${userId}:${domainId}`;
		permError = '';
		try {
			const res = await fetch(`/api/admin/users/${userId}/domains`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId, ...next })
			});
			const body = await res.json();
			if (!res.ok) {
				permError = body.error ?? 'Could not update domain access';
				return;
			}
			if (body.permission) {
				domainPermissions = {
					...domainPermissions,
					[userId]: { ...domainPermissions[userId], [domainId]: body.permission }
				};
			}
		} catch {
			permError = 'Network error';
		} finally {
			permBusy = '';
		}
	}
</script>

<svelte:head>
	<title>Users — Admin</title>
</svelte:head>

<HubShell title="Users" backHref="/admin">
	<GroupedPanel title="New user" hint="Address is their login.">
		<form class="user-form" onsubmit={createUser}>
			<input type="text" bind:value={name} required placeholder="Display name" class="admin-input" />
			<AddressField
				bind:localPart
				bind:domainId={newUserDomainId}
				domains={data.domains}
				placeholder="name"
				label="Address"
			/>
			<input
				type="text"
				bind:value={password}
				required
				minlength="12"
				placeholder="Temporary password"
				class="admin-input"
			/>

			{#if userError}<p class="error">{userError}</p>{/if}

			<button type="submit" disabled={creatingUser} class="btn-primary">
				{creatingUser ? 'Creating…' : 'Create'}
			</button>
		</form>
	</GroupedPanel>

	<GroupedPanel
		title="{data.users.length} users"
		hint="Throttle send, receive, and new addresses per domain. Full access until you turn something off."
	>
		<ul class="user-list">
			{#each data.users as user (user.id)}
				<li class="user-item">
					<div class="user-row">
						<div class="user-avatar">{(user.name[0] ?? '?').toUpperCase()}</div>
						<div class="min-w-0 flex-1">
							<p class="user-name">{user.name}</p>
							<p class="user-email">
								{data.addresses
									.filter((address) => address.user_id === user.id)
									.map((address) => address.address)
									.join(', ') || user.email}
							</p>
						</div>
						{#if user.is_admin}
							<span class="admin-badge">Admin</span>
						{/if}
					</div>

					{#if user.is_admin}
						<p class="user-perm-note">Admins can use every connected domain.</p>
					{:else if data.domains.length > 0}
						<ul class="perm-list">
							{#each data.domains as domain (domain.id)}
								<li class="perm-row">
									<span class="perm-domain">{domain.name}</span>
									<div class="perm-flags">
										<Check
											label="Send on {domain.name}"
											caption="send"
											checked={flagsFor(user.id, domain.id).can_send}
											disabled={permBusy === `${user.id}:${domain.id}`}
											onchange={(next) => setDomainFlag(user.id, domain.id, 'can_send', next)}
										/>
										<Check
											label="Receive on {domain.name}"
											caption="receive"
											checked={flagsFor(user.id, domain.id).can_receive}
											disabled={permBusy === `${user.id}:${domain.id}`}
											onchange={(next) => setDomainFlag(user.id, domain.id, 'can_receive', next)}
										/>
										<Check
											label="Add addresses on {domain.name}"
											caption="addresses"
											checked={flagsFor(user.id, domain.id).can_create_address}
											disabled={permBusy === `${user.id}:${domain.id}`}
											onchange={(next) =>
												setDomainFlag(user.id, domain.id, 'can_create_address', next)}
										/>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		{#if permError}<p class="error">{permError}</p>{/if}
	</GroupedPanel>
</HubShell>

<style>
	.user-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.admin-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.admin-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.user-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.user-item + .user-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.user-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
	}

	.user-perm-note {
		padding: 0 0 0.75rem 3rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.perm-list {
		margin: 0;
		padding: 0 0 0.75rem 3rem;
		list-style: none;
	}

	.perm-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.375rem 0;
	}

	.perm-domain {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.perm-flags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.user-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.user-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.user-email {
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.admin-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 640px) {
		.user-perm-note,
		.perm-list {
			padding-left: 0;
		}

		.perm-row {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>

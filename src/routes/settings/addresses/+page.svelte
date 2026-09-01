<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import SignatureEditor from '$lib/components/SignatureEditor.svelte';
	import type { MailAddress, Domain } from '$lib/types';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let edited = $state<MailAddress[] | null>(null);
	const addresses = $derived<MailAddress[]>(edited ?? data.addresses);
	let customizing = $state<Record<string, boolean>>({});
	let mailboxDrafts = $state<Record<string, string>>({});

	$effect(() => {
		for (const address of addresses) {
			if ((customizing[address.id] || address.signature) && !(address.id in mailboxDrafts)) {
				mailboxDrafts[address.id] = address.signature ?? '';
			}
		}
	});

	let localPart = $state('');
	let displayName = $state('');
	let domainId = $state('');
	let error = $state('');
	let busy = $state(false);
	let savingId = $state('');

	$effect(() => {
		if (!domainId && data.addressableDomains[0]) {
			domainId = data.addressableDomains[0].id;
		}
	});

	const selectedDomain = $derived(
		data.addressableDomains.find((domain: Domain) => domain.id === domainId)
	);

	async function addAddress(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';

		try {
			const res = await fetch('/api/addresses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId, localPart, label: displayName.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not add that address';
				return;
			}
			edited = [...addresses, body.address];
			localPart = '';
			displayName = '';
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}

	async function saveLabel(id: string, label: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.label ?? '') === label.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: label.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save that name';
				return;
			}
			edited = body.addresses;
		} catch {
			error = 'Network error';
		} finally {
			savingId = '';
		}
	}

	async function makeDefault(id: string) {
		const res = await fetch(`/api/addresses/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isDefault: true })
		});
		const body = await res.json();
		if (res.ok) edited = body.addresses;
	}

	async function saveMailboxSignature(id: string, value: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.signature ?? '') === value.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature: value })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save that signature';
				return;
			}
			edited = body.addresses;
		} catch {
			error = 'Network error';
		} finally {
			savingId = '';
		}
	}

	async function saveMailboxSignatureId(id: string, signatureId: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.signature_id ?? '') === signatureId) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signatureId: signatureId || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save that signature';
				return;
			}
			edited = body.addresses;
			customizing = { ...customizing, [id]: false };
		} catch {
			error = 'Network error';
		} finally {
			savingId = '';
		}
	}

	async function remove(id: string) {
		const res = await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			error = body.error ?? 'Could not remove that address';
			return;
		}
		edited = body.addresses;
	}
</script>

<svelte:head>
	<title>Addresses — Settings</title>
</svelte:head>

<HubShell title="Addresses" backHref="/settings">
	<GroupedPanel
		hint="The From name is what recipients see. Pin a saved signature to an address, or leave it on the account default."
	>
		<ul class="address-list">
			{#each addresses as address (address.id)}
				<li class="address-row">
					<div class="address-head">
						<div class="min-w-0 flex-1">
							<input
								type="text"
								class="name-input"
								value={address.label ?? ''}
								placeholder="From name"
								aria-label="From name for {address.address}"
								disabled={savingId === address.id}
								onchange={(event) => saveLabel(address.id, event.currentTarget.value)}
							/>
							<p class="address-domain">{address.address}</p>
						</div>

						{#if address.is_default}
							<span class="badge">Default</span>
						{:else}
							<button type="button" class="btn-ghost text-xs" onclick={() => makeDefault(address.id)}>
								Make default
							</button>
						{/if}

						{#if addresses.length > 1}
							<button
								type="button"
								class="icon-btn"
								aria-label="Remove {address.address}"
								onclick={() => remove(address.id)}
							>
								<Icon name="delete-bin-line" size={15} />
							</button>
						{/if}
					</div>
					{#if address.signature && !address.signature_id}
						<SignatureEditor
							bind:value={mailboxDrafts[address.id]}
							compact
							disabled={savingId === address.id}
							placeholderName={address.label || data.userName}
							onsave={(next) => saveMailboxSignature(address.id, next)}
						/>
					{:else}
						<label class="mailbox-pick">
							<span>Signature</span>
							<select
								class="text-input"
								value={address.signature_id ?? ''}
								disabled={savingId === address.id || data.signatures.length === 0}
								onchange={(event) => saveMailboxSignatureId(address.id, event.currentTarget.value)}
							>
								<option value="">Account default</option>
								{#each data.signatures as signature (signature.id)}
									<option value={signature.id}>{signature.name}</option>
								{/each}
							</select>
						</label>
					{/if}
				</li>
			{/each}
		</ul>

		{#if data.addressableDomains.length > 0}
			<form class="add-form" onsubmit={addAddress}>
				<div class="add-field">
					<label class="field-title" for="new-display-name">From name</label>
					<input
						id="new-display-name"
						type="text"
						bind:value={displayName}
						placeholder="Support"
						class="name-add-input"
						autocomplete="off"
					/>
					<AddressField
						bind:localPart
						bind:domainId
						domains={data.addressableDomains}
						placeholder="another"
						label="Address"
					/>
				</div>
				<button type="submit" class="btn-primary" disabled={busy || !localPart.trim()}>
					{busy ? 'Adding…' : 'Add'}
				</button>
			</form>
		{:else}
			<p class="hint">
				<Icon name="information-line" size={14} />
				Your admin has not granted permission to add addresses.
			</p>
		{/if}

		{#if selectedDomain && !selectedDomain.receiving_enabled}
			<p class="hint">
				<Icon name="information-line" size={14} />
				{selectedDomain.name} can send, but inbound is off.
			</p>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
	</GroupedPanel>
</HubShell>

<style>
	.address-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.address-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		padding: 0.75rem 0;
	}

	.address-row + .address-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.address-head {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.name-input {
		width: 100%;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: transparent;
		border: none;
		outline: none;
	}

	.name-input::placeholder {
		color: var(--color-muted);
		font-weight: 400;
	}

	.address-domain {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.mailbox-pick {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-well);
	}

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.name-add-input {
		width: 100%;
		margin: 0.5rem 0 0.875rem;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.name-add-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.add-form {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.add-field {
		flex: 1;
		min-width: 0;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 640px) {
		.add-form {
			flex-direction: column;
			align-items: stretch;
		}

		.add-form .btn-primary {
			width: 100%;
		}
	}
</style>

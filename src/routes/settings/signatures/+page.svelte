<script lang="ts">
	import { untrack } from 'svelte';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SignatureEditor from '$lib/components/SignatureEditor.svelte';
	import {
		MAX_EMAIL_SIGNATURE_LENGTH,
		MAX_SAVED_SIGNATURES,
		type SavedSignature
	} from '$lib/email-signature';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let signatures = $state<SavedSignature[]>(untrack(() => data.signatures));
	let activeSignatureId = $state(untrack(() => data.signatures[0]?.id ?? ''));
	let nameDraft = $state(untrack(() => data.signatures[0]?.name ?? 'Signature'));
	let bodyDraft = $state(untrack(() => data.signatures[0]?.body ?? ''));
	let signatureBusy = $state(false);
	let signatureError = $state('');
	let signatureSaved = $state(false);

	const activeSignature = $derived(
		signatures.find((signature) => signature.id === activeSignatureId) ?? null
	);

	function selectSignature(id: string) {
		activeSignatureId = id;
		const next = signatures.find((signature) => signature.id === id);
		nameDraft = next?.name ?? 'Signature';
		bodyDraft = next?.body ?? '';
		signatureSaved = false;
		signatureError = '';
	}

	function applySignatures(next: SavedSignature[], preferId?: string) {
		signatures = next;
		const id =
			(preferId && next.some((signature) => signature.id === preferId) ? preferId : null) ??
			next.find((signature) => signature.is_default)?.id ??
			next[0]?.id ??
			'';
		selectSignature(id);
	}

	async function addSignature() {
		if (signatureBusy || signatures.length >= MAX_SAVED_SIGNATURES) return;
		signatureBusy = true;
		signatureError = '';
		signatureSaved = false;
		try {
			const res = await fetch('/api/signatures', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not add a signature';
				return;
			}
			const created = (body.signatures as SavedSignature[]).at(-1);
			applySignatures(body.signatures, created?.id);
		} catch {
			signatureError = 'Network error';
		} finally {
			signatureBusy = false;
		}
	}

	async function saveSignature(event?: SubmitEvent) {
		event?.preventDefault();
		if (!activeSignatureId) {
			await addSignature();
			return;
		}
		signatureBusy = true;
		signatureError = '';
		signatureSaved = false;
		try {
			const res = await fetch(`/api/signatures/${activeSignatureId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: nameDraft, body: bodyDraft })
			});
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not save signature';
				return;
			}
			applySignatures(body.signatures, activeSignatureId);
			signatureSaved = true;
		} catch {
			signatureError = 'Network error';
		} finally {
			signatureBusy = false;
		}
	}

	async function makeSignatureDefault() {
		if (!activeSignatureId || activeSignature?.is_default) return;
		signatureBusy = true;
		signatureError = '';
		try {
			const res = await fetch(`/api/signatures/${activeSignatureId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isDefault: true })
			});
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not set the default';
				return;
			}
			applySignatures(body.signatures, activeSignatureId);
		} catch {
			signatureError = 'Network error';
		} finally {
			signatureBusy = false;
		}
	}

	async function deleteActiveSignature() {
		if (!activeSignatureId) return;
		signatureBusy = true;
		signatureError = '';
		signatureSaved = false;
		try {
			const res = await fetch(`/api/signatures/${activeSignatureId}`, { method: 'DELETE' });
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not delete that signature';
				return;
			}
			applySignatures(body.signatures);
		} catch {
			signatureError = 'Network error';
		} finally {
			signatureBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Signatures — Settings</title>
</svelte:head>

<HubShell title="Signatures" backHref="/settings">
	<GroupedPanel
		hint="Save up to {MAX_SAVED_SIGNATURES}. Switch between them when you write a message."
	>
		<div class="signature-tabs" role="tablist" aria-label="Saved signatures">
			{#each signatures as signature (signature.id)}
				<button
					type="button"
					role="tab"
					class="signature-tab"
					class:active={signature.id === activeSignatureId}
					aria-selected={signature.id === activeSignatureId}
					disabled={signatureBusy}
					onclick={() => selectSignature(signature.id)}
				>
					{signature.name}
					{#if signature.is_default}<span class="tab-default">Default</span>{/if}
				</button>
			{/each}
			{#if signatures.length < MAX_SAVED_SIGNATURES}
				<button
					type="button"
					class="signature-tab add"
					disabled={signatureBusy}
					onclick={addSignature}
				>
					<Icon name="add-line" size={14} />
					New
				</button>
			{/if}
		</div>

		{#if activeSignature}
			<form class="signature-form" onsubmit={saveSignature}>
				<label class="field-title" for="signature-name">Name</label>
				<input
					id="signature-name"
					class="text-input"
					bind:value={nameDraft}
					maxlength="40"
					disabled={signatureBusy}
					placeholder="Work"
				/>

				<SignatureEditor
					bind:value={bodyDraft}
					disabled={signatureBusy}
					placeholderName={data.userName}
				/>

				<div class="signature-actions">
					<span class="character-count">{bodyDraft.length}/{MAX_EMAIL_SIGNATURE_LENGTH}</span>
					<div class="signature-buttons">
						{#if !activeSignature.is_default}
							<button
								type="button"
								class="btn-ghost"
								disabled={signatureBusy}
								onclick={makeSignatureDefault}
							>
								Make default
							</button>
						{/if}
						<button
							type="button"
							class="btn-ghost"
							disabled={signatureBusy}
							onclick={deleteActiveSignature}
						>
							Delete
						</button>
						<button type="submit" class="btn-primary" disabled={signatureBusy}>
							{signatureBusy ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>

				{#if signatureError}<p class="error">{signatureError}</p>{/if}
				{#if signatureSaved}<p class="saved">Saved</p>{/if}
			</form>
		{:else}
			<p class="empty-signatures">No signatures yet.</p>
			<button type="button" class="btn-primary" disabled={signatureBusy} onclick={addSignature}>
				Create a signature
			</button>
			{#if signatureError}<p class="error">{signatureError}</p>{/if}
		{/if}
	</GroupedPanel>
</HubShell>

<style>
	.signature-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.signature-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.signature-tab:hover:not(:disabled) {
		background: var(--color-well);
	}

	.signature-tab.active {
		color: var(--color-text);
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.signature-tab.add {
		color: var(--color-muted);
	}

	.tab-default {
		font-size: 0.6875rem;
		color: var(--color-muted);
	}

	.signature-form {
		margin-top: 1rem;
	}

	.field-title {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
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

	.signature-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.character-count {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.signature-buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.375rem;
	}

	.empty-signatures {
		margin: 0.75rem 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}
</style>

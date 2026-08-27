<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import RecipientField from '$lib/components/RecipientField.svelte';
	import LoadingButton from '$lib/interior/LoadingButton.svelte';
	import SignaturePreview from '$lib/components/SignaturePreview.svelte';
	import SignaturePicker from '$lib/components/SignaturePicker.svelte';
	import { queueMailSend } from '$lib/pending-send';
	import { isMod } from '$lib/shortcuts';
	import {
		compileSignature,
		defaultComposeSignatureId,
		parseSignatureConfig,
		resolveSignatureBody
	} from '$lib/email-signature';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { page } from '$app/stores';
	import type { OutboundAttachmentInput } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const addresses = $derived(data.addresses);
	const defaultAddressId = $derived(
		addresses.find((address) => address.is_default)?.id ?? addresses[0]?.id ?? ''
	);

	// Falls back to the default identity until the composer picks another.
	let chosenAddressId = $state('');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	// The draft seeds the form once; after that the fields own their values.
	const draft = untrack(() => data.draft);

	let draftId = $state<string | null>(draft?.id ?? null);
	let to = $state(draft?.to_addr ?? '');
	let cc = $state(draft?.cc_addr ?? '');
	let bcc = $state(draft?.bcc_addr ?? '');
	let subject = $state(draft?.subject ?? '');
	let html = $state(draft?.body_html ?? '');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let error = $state('');
	let sending = $state(false);
	let savingDraft = $state(false);
	let savedAt = $state('');

	const isEmpty = $derived(
		!to.trim() && !cc.trim() && !bcc.trim() && !subject.trim() && isHtmlEmpty(html)
	);
	const selectedAddress = $derived(addresses.find((address) => address.id === fromAddressId));
	let lastFromId = $state('');
	let selectedSignatureId = $state('');
	$effect(() => {
		if (fromAddressId === lastFromId) return;
		lastFromId = fromAddressId;
		selectedSignatureId = defaultComposeSignatureId(
			data.signatures,
			selectedAddress?.signature_id
		);
	});
	const storedSignature = $derived(
		resolveSignatureBody({
			signatures: data.signatures,
			selectedId: selectedSignatureId,
			mailboxSignatureId: selectedAddress?.signature_id,
			mailboxBody: selectedAddress?.signature
		})
	);
	const compiledSignature = $derived(
		compileSignature(parseSignatureConfig(storedSignature), $page.url.origin)
	);

	async function saveDraft() {
		if (savingDraft || isEmpty) return;
		savingDraft = true;
		error = '';

		try {
			const res = await fetch('/api/drafts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: draftId,
					fromAddressId,
					to,
					cc: cc.trim() || undefined,
					bcc: bcc.trim() || undefined,
					subject,
					html,
					text: isHtmlEmpty(html) ? '' : htmlToPlainText(html)
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save draft';
				return;
			}
			draftId = body.id;
			savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			error = 'Network error';
		} finally {
			savingDraft = false;
		}
	}

	async function discardDraft() {
		if (!draftId) {
			window.location.href = '/inbox';
			return;
		}
		await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
		window.location.href = '/drafts';
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (sending) return;
		if (isHtmlEmpty(html)) {
			error = 'Write a message';
			return;
		}

		sending = true;
		error = '';
		const payload = {
			draftId: draftId ?? undefined,
			fromAddressId,
			to,
			cc: cc.trim() || undefined,
			bcc: bcc.trim() || undefined,
			subject,
			html,
			text: htmlToPlainText(html),
			attachments,
			signatureId: data.signatures.length ? selectedSignatureId || null : undefined
		};

		queueMailSend({
			send: async () => {
				const res = await fetch('/api/mail', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to send');
				window.location.href = '/sent';
			},
			undo: () => {
				sending = false;
			},
			onError: (message) => {
				error = message;
				sending = false;
			}
		});
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (isMod(event) && event.key === 'Enter') {
			event.preventDefault();
			document.querySelector<HTMLFormElement>('.compose-page')?.requestSubmit();
		}
	}}
/>

<svelte:head>
	<title>{draftId ? 'Draft' : 'Compose'} — Mail</title>
</svelte:head>

<form class="compose-page" onsubmit={submit}>
	<header class="compose-header">
		<div class="compose-heading">
			<h1 class="page-title">{draftId ? 'Draft' : 'New message'}</h1>
			{#if savedAt}<span class="saved">Saved {savedAt}</span>{/if}
		</div>

		<div class="compose-actions">
			<button type="button" class="btn-ghost" disabled={savingDraft || isEmpty} onclick={saveDraft}>
				<Icon name="save-line" size={15} />
				{savingDraft ? 'Saving…' : 'Save draft'}
			</button>
			{#if draftId}
				<button type="button" class="btn-ghost" onclick={discardDraft} aria-label="Discard draft">
					<Icon name="delete-bin-line" size={15} />
				</button>
			{/if}
			<LoadingButton
				type="submit"
				tone="accent"
				label="Send"
				pendingLabel="Sending"
				successLabel="Sent"
				status={sending ? 'pending' : 'idle'}
				disabled={sending}
			/>
		</div>
	</header>

	<div class="surface compose-fields">
		<!-- With several domains connected, choosing the identity matters. -->
		<div class="field-row">
			<span class="field-label">From</span>
			{#if addresses.length > 1}
				<select
					value={fromAddressId}
					onchange={(event) => (chosenAddressId = event.currentTarget.value)}
					class="field-input"
					aria-label="Send from"
				>
					{#each addresses as address (address.id)}
						<option value={address.id}>
							{address.label ? `${address.label} · ${address.address}` : address.address}
						</option>
					{/each}
				</select>
			{:else}
				<span class="field-static">
					{addresses[0]?.label
						? `${addresses[0].label} · ${addresses[0].address}`
						: (addresses[0]?.address ?? '—')}
				</span>
			{/if}
		</div>

		<div class="field-row">
			<span class="field-label">To</span>
			<RecipientField id="to" label="To" bind:value={to} required placeholder="Add recipients" />
		</div>

		<div class="field-row">
			<span class="field-label">Cc</span>
			<RecipientField id="cc" label="Cc" bind:value={cc} placeholder="People who should see this" />
		</div>

		<div class="field-row">
			<span class="field-label">Bcc</span>
			<RecipientField id="bcc" label="Bcc" bind:value={bcc} placeholder="Hidden copies" />
		</div>

		<div class="field-row">
			<span class="field-label">Subject</span>
			<input
				id="subject"
				type="text"
				bind:value={subject}
				required
				placeholder="Subject"
				class="field-input"
			/>
		</div>
	</div>

	<div class="mt-4">
		<RichTextEditor bind:html minHeight={220} />
	</div>

	{#if data.signatures.length > 0}
		<div class="signature-preview">
			<SignaturePicker bind:value={selectedSignatureId} signatures={data.signatures} />
			{#if compiledSignature.html}
				<SignaturePreview html={compiledSignature.html} />
			{/if}
		</div>
	{/if}

	<div class="mt-4 px-1">
		<AttachmentPicker bind:attachments />
	</div>

	{#if error}
		<p class="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
	{/if}
</form>

<style>
	.compose-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.compose-heading {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}

	.saved {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.compose-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.compose-fields {
		overflow: hidden;
	}

	.field-static {
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
	}

	.signature-preview {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	@media (max-width: 900px) {
		.compose-page {
			padding-bottom: calc(4.75rem + env(safe-area-inset-bottom));
		}

		.compose-header {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
			margin-bottom: 1rem;
		}

		.compose-actions {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 28;
			justify-content: flex-end;
			flex-wrap: wrap;
			gap: 0.375rem;
			padding: 0.625rem 0.75rem calc(0.625rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.compose-actions .btn-ghost {
			padding: 0.5rem 0.75rem;
		}
	}
</style>

<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import RecipientField from '$lib/components/RecipientField.svelte';
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

	let chosenAddressId = $state('');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	const draft = untrack(() => data.draft);
	const forward = untrack(() => data.forward);

	const initialShowDetails = untrack(() =>
		Boolean(draft?.cc_addr || draft?.bcc_addr || data.addresses.length > 1)
	);

	let draftId = $state<string | null>(draft?.id ?? null);
	let to = $state(draft?.to_addr ?? '');
	let cc = $state(draft?.cc_addr ?? '');
	let bcc = $state(draft?.bcc_addr ?? '');
	let subject = $state(draft?.subject ?? forward?.subject ?? '');
	let html = $state(draft?.body_html ?? forward?.html ?? '');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let error = $state('');
	let sending = $state(false);
	let savingDraft = $state(false);
	let savedAt = $state('');
	let showDetails = $state(initialShowDetails);
	let showExtras = $state(false);

	const pageTitle = $derived(
		draftId ? 'Draft' : forward ? 'Forward' : 'New Message'
	);

	const isEmpty = $derived(
		!to.trim() && !cc.trim() && !bcc.trim() && !subject.trim() && isHtmlEmpty(html)
	);
	const canSend = $derived(Boolean(to.trim()) && !isHtmlEmpty(html) && !sending);

	const selectedAddress = $derived(addresses.find((address) => address.id === fromAddressId));
	const fromLabel = $derived(
		selectedAddress?.label
			? `${selectedAddress.label} · ${selectedAddress.address}`
			: (selectedAddress?.address ?? '—')
	);

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

	function closeComposer() {
		if (window.history.length > 1) window.history.back();
		else window.location.href = '/inbox';
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
		if (sending || !canSend) return;
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
		if (isMod(event) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void saveDraft();
		}
	}}
/>

<svelte:head>
	<title>{pageTitle} — Mail</title>
</svelte:head>

<form class="compose-page" onsubmit={submit}>
	<div class="compose-sheet">
		<div class="compose-grab" aria-hidden="true"></div>

		<div class="compose-toolbar">
			<button type="button" class="compose-circle" aria-label="Close" onclick={closeComposer}>
				<Icon name="close-line" size={20} />
			</button>

			<div class="compose-toolbar-meta">
				{#if savedAt}<span class="saved">Saved {savedAt}</span>{/if}
			</div>

			<div class="compose-toolbar-actions">
				<button
					type="button"
					class="compose-circle"
					aria-label="More options"
					aria-expanded={showExtras}
					onclick={() => (showExtras = !showExtras)}
				>
					<Icon name="attachment-2" size={18} />
				</button>
				<button
					type="submit"
					class="compose-circle send"
					class:ready={canSend}
					aria-label="Send"
					disabled={!canSend}
				>
					<Icon name="arrow-up-line" size={20} />
				</button>
			</div>
		</div>

		{#if showExtras}
			<div class="compose-extras">
				<button
					type="button"
					class="compose-extra-btn"
					disabled={savingDraft || isEmpty}
					onclick={saveDraft}
				>
					<Icon name="save-line" size={16} />
					{savingDraft ? 'Saving…' : 'Save draft'}
				</button>
				{#if draftId}
					<button type="button" class="compose-extra-btn danger" onclick={discardDraft}>
						<Icon name="delete-bin-line" size={16} />
						Discard
					</button>
				{/if}
			</div>
		{/if}

		<h1 class="compose-title">{pageTitle}</h1>

		<div class="compose-canvas">
			<div class="compose-row">
				<label class="compose-label" for="compose-to">To:</label>
				<RecipientField
					id="compose-to"
					label="To"
					bind:value={to}
					required
					placeholder=""
				/>
			</div>

			{#if showDetails}
				<div class="compose-row">
					<label class="compose-label" for="compose-cc">Cc:</label>
					<RecipientField id="compose-cc" label="Cc" bind:value={cc} placeholder="" />
				</div>
				<div class="compose-row">
					<label class="compose-label" for="compose-bcc">Bcc:</label>
					<RecipientField id="compose-bcc" label="Bcc" bind:value={bcc} placeholder="" />
				</div>
				<div class="compose-row">
					<span class="compose-label">From:</span>
					{#if addresses.length > 1}
						<select
							value={fromAddressId}
							onchange={(event) => (chosenAddressId = event.currentTarget.value)}
							class="compose-input compose-select"
							aria-label="Send from"
						>
							{#each addresses as address (address.id)}
								<option value={address.id}>
									{address.label ? `${address.label} · ${address.address}` : address.address}
								</option>
							{/each}
						</select>
					{:else}
						<span class="compose-meta-value">{fromLabel}</span>
					{/if}
				</div>
			{:else}
				<button type="button" class="compose-row compose-meta-toggle" onclick={() => (showDetails = true)}>
					<span class="compose-label">Cc/Bcc, From:</span>
					<span class="compose-meta-value">{fromLabel}</span>
				</button>
			{/if}

			<div class="compose-row">
				<label class="compose-label" for="compose-subject">Subject:</label>
				<input
					id="compose-subject"
					type="text"
					bind:value={subject}
					required
					class="compose-input"
				/>
			</div>

			<div class="compose-body">
				<RichTextEditor bind:html embedded showToolbar={false} minHeight={280} placeholder="" />
			</div>

			{#if showExtras}
				<div class="compose-attachments">
					<AttachmentPicker bind:attachments />
				</div>
				{#if data.signatures.length > 0}
					<div class="compose-signature">
						<SignaturePicker bind:value={selectedSignatureId} signatures={data.signatures} />
						{#if compiledSignature.html}
							<SignaturePreview html={compiledSignature.html} />
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		{#if error}
			<p class="compose-error">{error}</p>
		{/if}
	</div>
</form>

<style>
	.compose-page {
		min-height: 100%;
	}

	.compose-sheet {
		display: flex;
		flex-direction: column;
		min-height: 100%;
		background: var(--color-surface);
	}

	.compose-grab {
		display: none;
	}

	.compose-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem 0.25rem;
	}

	.compose-toolbar-meta {
		flex: 1;
		min-width: 0;
		text-align: center;
	}

	.compose-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.compose-circle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 999px;
		color: var(--color-text-secondary);
		background: var(--color-well);
		transition: background 0.15s, color 0.15s, opacity 0.15s;
	}

	.compose-circle.send {
		color: var(--color-muted);
	}

	.compose-circle.send.ready {
		color: var(--color-on-accent);
		background: #007aff;
	}

	.compose-circle:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.saved {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.compose-extras {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0 1rem 0.5rem;
	}

	.compose-extra-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border: none;
		border-radius: 999px;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-well);
	}

	.compose-extra-btn.danger {
		color: var(--color-danger);
	}

	.compose-title {
		padding: 0.25rem 1rem 0.75rem;
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	.compose-canvas {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 0 1rem 1.5rem;
	}

	.compose-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.75rem;
		padding: 0.375rem 0;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.compose-meta-toggle {
		width: 100%;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.compose-label {
		flex-shrink: 0;
		font-size: 1.0625rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.compose-meta-value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.0625rem;
		color: var(--color-text-secondary);
	}

	.compose-input {
		flex: 1;
		min-width: 0;
		border: none;
		font-size: 1.0625rem;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.compose-input::placeholder {
		color: var(--color-muted);
	}

	.compose-select {
		padding: 0;
		appearance: none;
	}

	.compose-body {
		flex: 1;
		min-height: 0;
		padding-top: 0.25rem;
	}

	.compose-body :global(.editor-shell) {
		height: 100%;
	}

	.compose-body :global(.editor) {
		min-height: 18rem;
		font-size: 1.0625rem;
		line-height: 1.45;
	}

	.compose-attachments,
	.compose-signature {
		margin-top: 1rem;
		padding-top: 1rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.compose-signature {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.compose-error {
		margin: 0 1rem 1rem;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.compose-row :global(.field-input) {
		font-size: 1.0625rem;
	}

	@media (min-width: 901px) {
		.compose-page {
			display: flex;
			justify-content: center;
			padding: 1.5rem 1rem 2rem;
		}

		.compose-sheet {
			width: min(100%, 42rem);
			min-height: auto;
			border-radius: 20px;
			box-shadow: var(--mat-panel);
		}

		.compose-grab {
			display: none;
		}

		.compose-title {
			font-size: 1.75rem;
		}

		.compose-body :global(.editor) {
			min-height: 14rem;
		}
	}

	@media (max-width: 900px) {
		.compose-grab {
			display: block;
			width: 2.25rem;
			height: 0.3125rem;
			margin: 0.375rem auto 0;
			border-radius: 999px;
			background: var(--color-line-strong);
		}

		.compose-sheet {
			min-height: 100%;
			border-radius: 14px 14px 0 0;
		}

		.compose-toolbar {
			padding-top: 0.5rem;
		}

		.compose-title {
			font-size: 2.125rem;
		}

		.compose-canvas {
			padding-bottom: calc(1rem + env(safe-area-inset-bottom));
		}
	}
</style>

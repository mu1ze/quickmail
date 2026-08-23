<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import ThreadMessage from '$lib/components/ThreadMessage.svelte';
	import SnoozeMenu from '$lib/components/SnoozeMenu.svelte';
	import SignaturePreview from '$lib/components/SignaturePreview.svelte';
	import SignaturePicker from '$lib/components/SignaturePicker.svelte';
	import { queueMailSend } from '$lib/pending-send';
	import { isMod, isTypingTarget } from '$lib/shortcuts';
	import { showUndo } from '$lib/undo';
	import { compileSignature, parseSignatureConfig, resolveSignatureBody } from '$lib/email-signature';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { page } from '$app/stores';
	import type { OutboundAttachmentInput } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let replyHtml = $state('');
	let replyAttachments = $state<OutboundAttachmentInput[]>([]);
	let replyOpen = $state(false);
	let sending = $state(false);
	let error = $state('');
	let snoozeOpen = $state(false);
	let selectedSignatureId = $state('');

	const messages = $derived(data.messages);
	const latest = $derived(messages[messages.length - 1]);
	const replyAddress = $derived(
		data.addresses.find((address) => address.address === data.replyFrom) ?? null
	);
	const storedReplySignature = $derived(
		resolveSignatureBody({
			signatures: data.signatures,
			selectedId: selectedSignatureId,
			mailboxSignatureId: replyAddress?.signature_id,
			mailboxBody: replyAddress?.signature
		})
	);
	const compiledReplySignature = $derived(
		compileSignature(parseSignatureConfig(storedReplySignature), $page.url.origin)
	);
	const starred = $derived(messages.some((message) => message.is_starred));

	const backHref = $derived(
		data.trashed ? '/trash' : data.snoozedUntil ? '/later' : latest?.direction === 'outbound' ? '/sent' : '/inbox'
	);

	/**
	 * Which messages are open: the newest one, whichever message was linked to,
	 * and anything the reader clicks.
	 */
	let opened = $state(new Set<string>());

	$effect(() => {
		const initial = new Set<string>();
		if (data.focusId) initial.add(data.focusId);
		const last = data.messages[data.messages.length - 1];
		if (last) initial.add(last.id);
		opened = initial;
	});

	function toggleMessage(id: string) {
		const next = new Set(opened);
		if (next.has(id) && next.size > 1) next.delete(id);
		else next.add(id);
		opened = next;
	}

	function expandAll() {
		opened = new Set(messages.map((message) => message.id));
	}

	const collapsedCount = $derived(messages.filter((message) => !opened.has(message.id)).length);

	/** Flags apply to the conversation, not to the message that opened it. */
	async function patch(id: string, body: Record<string, unknown>) {
		await fetch(`/api/mail/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function toggleStar() {
		if (!latest) return;
		await patch(latest.id, { isStarred: !starred });
		await invalidateAll();
	}

	async function markUnread() {
		if (!latest) return;
		await patch(latest.id, { isRead: false });
		goto(backHref);
	}

	async function trash() {
		const id = latest?.id;
		if (!id) return;
		const dest = backHref;
		await patch(id, { trashed: true });
		showUndo('Moved to trash', () => patch(id, { trashed: false }));
		goto(dest);
	}

	async function restore() {
		if (!latest) return;
		await patch(latest.id, { trashed: false });
		goto('/inbox');
	}

	async function destroy() {
		if (!latest) return;
		await fetch(`/api/mail/${latest.id}`, { method: 'DELETE' });
		goto('/trash');
	}

	async function snooze(until: string) {
		const id = latest?.id;
		if (!id) return;
		snoozeOpen = false;
		await patch(id, { snoozedUntil: until });
		showUndo('Snoozed until later', () => patch(id, { snoozedUntil: null }));
		goto('/inbox');
	}

	async function unsnooze() {
		const id = latest?.id;
		const until = data.snoozedUntil;
		if (!id) return;
		await patch(id, { snoozedUntil: null });
		showUndo('Moved to inbox', () => (until ? patch(id, { snoozedUntil: until }) : Promise.resolve()));
		goto('/inbox');
	}

	/** Replies continue from the newest message, so the chain stays intact. */
	function sendReply(event: SubmitEvent) {
		event.preventDefault();
		queueReply();
	}

	function queueReply() {
		if (!latest || isHtmlEmpty(replyHtml) || sending) return;
		const id = latest.id;
		const html = replyHtml;
		const attachments = replyAttachments;
		sending = true;
		error = '';
		queueMailSend({
			send: async () => {
				const res = await fetch(`/api/mail/${id}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						html,
						text: htmlToPlainText(html),
						attachments,
						signatureId: data.signatures.length ? selectedSignatureId || null : undefined,
						includeSignature: Boolean(selectedSignatureId)
					})
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to send');
				replyHtml = '';
				replyAttachments = [];
				replyOpen = false;
				sending = false;
				await invalidateAll();
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

	function onThreadKeydown(event: KeyboardEvent) {
		if (isTypingTarget(event.target) || document.querySelector('[data-overlay]')) return;
		if (isMod(event) && event.key === 'Enter') {
			event.preventDefault();
			if (replyOpen) queueReply();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'r') {
			event.preventDefault();
			replyOpen = true;
			return;
		}
		if (event.key === 'e' && !data.trashed) {
			event.preventDefault();
			void trash();
			return;
		}
		if (event.key === 's') {
			event.preventDefault();
			void toggleStar();
			return;
		}
		if (event.key === 'u') {
			event.preventDefault();
			void markUnread();
			return;
		}
		if (event.key === 'b' && !data.trashed) {
			event.preventDefault();
			if (data.snoozedUntil) void unsnooze();
			else snoozeOpen = !snoozeOpen;
		}
	}
</script>

<svelte:window onkeydown={onThreadKeydown} />

<svelte:head>
	<title>{data.subject} — Mail</title>
</svelte:head>

<div class="mail-page">
	<header class="mail-toolbar">
		<a href={backHref} class="btn-ghost" aria-label="Back">
			<Icon name="arrow-left-line" size={18} />
		</a>

		<div class="toolbar-actions">
			<button
				type="button"
				class="icon-btn"
				class:starred
				aria-label={starred ? 'Remove star' : 'Add star'}
				onclick={toggleStar}
			>
				<Icon name={starred ? 'star-fill' : 'star-line'} size={16} />
			</button>

			{#if data.trashed}
				<button type="button" class="icon-btn" aria-label="Restore" onclick={restore}>
					<Icon name="arrow-go-back-line" size={16} />
				</button>
				<button
					type="button"
					class="icon-btn danger"
					aria-label="Delete permanently"
					onclick={destroy}
				>
					<Icon name="delete-bin-2-line" size={16} />
				</button>
			{:else}
				<button type="button" class="icon-btn" aria-label="Mark as unread" onclick={markUnread}>
					<Icon name="mail-line" size={16} />
				</button>
				{#if data.snoozedUntil}
					<button type="button" class="icon-btn" aria-label="Move to inbox" onclick={unsnooze}>
						<Icon name="inbox-line" size={16} />
					</button>
				{:else}
					<div class="snooze-wrap">
						<button
							type="button"
							class="icon-btn"
							aria-label="Snooze"
							onclick={() => (snoozeOpen = !snoozeOpen)}
						>
							<Icon name="time-line" size={16} />
						</button>
						{#if snoozeOpen}
							<button
								type="button"
								class="backdrop"
								aria-label="Close snooze"
								onclick={() => (snoozeOpen = false)}
							></button>
							<SnoozeMenu onPick={snooze} onClose={() => (snoozeOpen = false)} />
						{/if}
					</div>
				{/if}
				<button type="button" class="icon-btn" aria-label="Move to trash" onclick={trash}>
					<Icon name="delete-bin-line" size={16} />
				</button>
			{/if}

			<button type="button" class="btn-primary" onclick={() => (replyOpen = !replyOpen)}>
				<Icon name="reply-line" size={16} />
				{replyOpen ? 'Close' : 'Reply'}
			</button>
		</div>
	</header>

	<article class="surface-lg mail-card">
		<div class="subject-row">
			<h1>{data.subject}</h1>
			{#if messages.length > 1}
				<span class="thread-count">{messages.length} messages</span>
			{/if}
		</div>

		{#if collapsedCount > 0}
			<button type="button" class="expand-all" onclick={expandAll}>
				Expand all {messages.length} messages
			</button>
		{/if}

		<div class="thread">
			{#each messages as message (message.id)}
				<ThreadMessage
					{message}
					expanded={opened.has(message.id)}
					onToggle={() => toggleMessage(message.id)}
				/>
			{/each}
		</div>

		{#if replyOpen}
			<form class="reply-section" onsubmit={sendReply}>
				<p class="reply-to">
					Replying to
					<strong>
						{latest?.direction === 'inbound' ? latest.from_addr : latest?.to_addr}
					</strong>
				</p>
				{#if data.replyFrom}
					<p class="reply-from">
						From
						<strong>
							{#if data.replyFromName}{data.replyFromName} · {/if}{data.replyFrom}
						</strong>
					</p>
				{/if}

				<RichTextEditor bind:html={replyHtml} embedded minHeight={160} placeholder="Reply…" />

				{#if selectedSignatureId && compiledReplySignature.html}
					<div class="signature-preview">
						<SignaturePreview html={compiledReplySignature.html} />
					</div>
				{/if}

				<div class="reply-footer">
					<AttachmentPicker bind:attachments={replyAttachments} />
					<div class="reply-actions">
						{#if data.signatures.length > 0}
							<SignaturePicker
								bind:value={selectedSignatureId}
								signatures={data.signatures}
								noneLabel="No signature"
								compact
							/>
						{/if}
						<button type="button" class="btn-ghost" onclick={() => (replyOpen = false)}>
							Cancel
						</button>
						<button type="submit" class="btn-primary" disabled={sending}>
							<Icon name="send-plane-2-fill" size={16} />
							{sending ? 'Sending…' : 'Send'}
						</button>
					</div>
				</div>

				{#if error}
					<p class="reply-status">{error}</p>
				{/if}
			</form>
		{:else}
			<button type="button" class="reply-prompt" onclick={() => (replyOpen = true)}>
				<Icon name="reply-line" size={15} />
				Reply
			</button>
		{/if}
	</article>
</div>

<style>
	.mail-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.toolbar-actions :global(.icon-btn.starred) {
		color: var(--color-star);
	}

	.toolbar-actions :global(.icon-btn.danger:hover) {
		color: var(--color-danger);
	}

	.snooze-wrap {
		position: relative;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
	}

	.mail-card {
		padding: 1.75rem;
	}

	.mail-card h1 {
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.35;
	}

	.subject-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding-bottom: 1rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.thread-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.expand-all {
		margin-top: 0.875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		text-decoration: underline;
	}

	.expand-all:hover {
		color: var(--color-text);
	}

	.reply-section {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.reply-to,
	.reply-from {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.reply-from {
		margin: 0.25rem 0 0.625rem;
	}

	.reply-to strong,
	.reply-from strong {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.signature-preview {
		margin-top: 0.75rem;
	}

	.reply-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.reply-actions {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	.reply-status {
		margin-top: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	/* Dormant reply box at the foot of the thread; opens the composer. */
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 1.5rem;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s;
	}

	.reply-prompt:hover {
		background: var(--color-surface-muted);
	}

	@media (max-width: 900px) {
		.mail-toolbar {
			margin-bottom: 0.875rem;
			gap: 0.5rem;
		}

		.mail-card {
			padding: 1rem 1rem 1.25rem;
		}

		.mail-card h1 {
			font-size: 1.125rem;
		}

		.subject-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.25rem;
		}

		.reply-footer {
			flex-direction: column;
			align-items: stretch;
		}

		.reply-actions {
			margin-left: 0;
			justify-content: flex-end;
		}

		.reply-prompt {
			min-height: 2.75rem;
		}
	}
</style>

<script lang="ts">
	import Icon from './Icon.svelte';
	import AttachmentList from './AttachmentList.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import EmailBody from './EmailBody.svelte';
	import PlainTextBody from './PlainTextBody.svelte';
	import VerificationCode from './VerificationCode.svelte';
	import { findVerificationCode } from '$lib/verification-code';
	import { formatFullDate, formatRelativeDate } from '$lib/utils/date';
	import { splitQuotedText } from '$lib/utils/quotes';
	import { buildMessagePreview } from '$lib/utils/message-preview';
	import { displayAddress } from '$lib/mailbox-people';
	import type { ThreadMessage } from '$lib/types';

	let {
		message,
		expanded = false,
		newest = false,
		onTrashCode,
		actionBusy = false,
		onToggle
	}: {
		message: ThreadMessage;
		expanded?: boolean;
		newest?: boolean;
		onTrashCode?: () => void;
		actionBusy?: boolean;
		onToggle: () => void;
	} = $props();

	const outbound = $derived(message.direction === 'outbound');
	const sender = $derived(outbound ? 'me' : message.from_name?.trim() || displayAddress(message.from_addr));
	const initial = $derived((sender[0] ?? '?').toUpperCase());

	/** Text-only messages get the same treatment as HTML ones. */
	const text = $derived(splitQuotedText(message.body_text ?? ''));

	/** One-line teaser for the collapsed state — the reply, not its quotes. */
	const snippet = $derived(buildMessagePreview(message.body_text?.trim() || message.body_html).slice(0, 140));

	/** Sign-in mail gets its code pulled out above the body. */
	const code = $derived(
		outbound ? null : findVerificationCode({ subject: message.subject, text: message.body_text, html: message.body_html })
	);

	let quoteOpen = $state(false);
	let plain = $state(false);
</script>

<article class="message" class:collapsed={!expanded} data-message-id={message.id}>
	{#if expanded}
		<header class="head">
			<div class="avatar" class:self={outbound}>{outbound ? 'me' : initial}</div>

			<button type="button" class="who" onclick={onToggle} aria-expanded={expanded} aria-label={`Collapse message from ${sender}`}>
				<p class="name">{sender}</p>
				<p class="route">
					{#if !outbound && sender !== message.from_addr}<span>{message.from_addr}</span>{/if}
					<span>to {message.to_addr}</span>
					{#if message.cc_addr}
						<span>cc {message.cc_addr}</span>
					{/if}
					{#if outbound && message.bcc_addr}
						<span>bcc {message.bcc_addr}</span>
					{/if}
				</p>
				<p class="when message-date"><span>{formatFullDate(message.created_at)}</span>{#if newest}<span class="latest-label">Latest</span>{/if}</p>
			</button>

			{#if outbound}
				<DeliveryStatus status={message.status} detail={message.status_detail} />
			{/if}
		</header>
		{#if code}<VerificationCode {code} variant="card" onTrash={onTrashCode} busy={actionBusy} cleanupAt={message.code_cleanup_at} />{/if}
		{#if message.body_html && message.body_text?.trim()}
			<button type="button" class="content-mode" aria-pressed={plain} onclick={() => (plain = !plain)}><Icon name={plain ? 'layout-line' : 'text'} size={13} />{plain ? 'View formatted message' : 'View plain text'}</button>
		{/if}

		<div class="body mail-body">
			{#if message.body_html && !plain}
				{#key message.id}
					<EmailBody html={message.body_html} emailId={message.id} attachments={message.attachments} />
				{/key}
			{:else if text.body}
				<PlainTextBody text={text.body} />
				{#if text.quoted}
					<button
						type="button"
						class="quote-toggle"
						aria-expanded={quoteOpen}
						aria-label={quoteOpen ? 'Hide quoted text' : 'Show quoted text'}
						onclick={() => (quoteOpen = !quoteOpen)}
					>
						···
					</button>
					{#if quoteOpen}
						<div class="quoted"><PlainTextBody text={text.quoted} /></div>
					{/if}
				{/if}
			{:else}
				<p class="empty">Empty message</p>
			{/if}
		</div>

		<AttachmentList emailId={message.id} attachments={message.attachments} compact />

		{#if message.status === 'bounced' || message.status === 'failed'}
			<p class="failure">
				<Icon name="error-warning-line" size={13} />
				{message.status_detail ?? "This message didn't reach the recipient."}
			</p>
		{/if}
	{:else}
		<button type="button" class="summary" onclick={onToggle} aria-expanded={expanded} aria-label={`Expand message from ${sender}`}>
			<span class="avatar small" class:self={outbound}>{outbound ? 'me' : initial}</span>
			<span class="name">{sender}</span>
			<span class="snippet">{snippet}</span>
			{#if message.attachments.length > 0}
				<Icon name="attachment-2" size={13} />
			{/if}
			<span class="when">{formatRelativeDate(message.created_at)}</span>
		</button>
	{/if}
</article>

<style>
	.when.message-date { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem 0.5rem; white-space: normal; }
	.latest-label { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px; background: var(--color-accent-soft); color: var(--color-accent-text); font-size: 0.625rem; }
	.content-mode { display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem; padding: 0.45rem 0.65rem; border: 1px solid var(--color-line); border-radius: 8px; color: var(--color-text-secondary); font-size: 0.7rem; }
	.content-mode:hover { background: var(--color-well); color: var(--color-text); }
	.message {
		padding: 1.25rem 0;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.message:last-child {
		box-shadow: none;
		padding-bottom: 0;
	}

	.collapsed {
		padding: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.avatar.self {
		color: var(--color-text-secondary);
		background: var(--color-surface-hover);
	}

	.avatar.small {
		width: 1.75rem;
		height: 1.75rem;
		font-size: 0.625rem;
	}

	.who {
		flex: 1;
		min-width: 0;
		text-align: left;
	}

	.name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.route {
		overflow-wrap: anywhere;
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.75rem;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		overflow: hidden;
	}

	.when {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.body {
		min-width: 0;
		overflow-wrap: anywhere;
		margin-top: 1rem;
		font-size: 0.9375rem;
	}

	.empty {
		font-style: italic;
		color: var(--color-muted);
	}

	.failure {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-danger);
	}

	/* --- collapsed row --- */

	.summary {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.75rem 0;
		color: var(--color-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
		text-align: left;
	}

	.summary:hover {
		color: var(--color-text-secondary);
	}

	.summary .name {
		max-width: 35%;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.snippet {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.summary .when {
		margin-top: 0;
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.quoted {
		margin-top: 0.5rem;
		padding-left: 0.75rem;
		color: var(--color-text-secondary);
		box-shadow: inset 2px 0 0 var(--color-line);
	}

	/* HTML messages fold their own quotes inside the message frame; this is the
	   same control for text-only mail. */
	.quote-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin: 0.5rem 0;
		padding: 0 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		line-height: 1.2;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		cursor: pointer;
	}

	.quote-toggle:hover {
		background: var(--color-surface-hover);
	}
</style>

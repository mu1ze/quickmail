<script lang="ts">
	import Icon from './Icon.svelte';
	import { searchValue } from '$lib/mail-search';
	let { open = $bindable(false), query = '', onSearch }: { open?: boolean; query?: string; onSearch: (query: string) => void } = $props();
	let dialog = $state<HTMLDialogElement>();
	const dialogId = $props.id();
	let from = $state('');
	let to = $state('');
	let subject = $state('');
	let words = $state('');
	let filename = $state('');
	let label = $state('');
	let after = $state('');
	let before = $state('');
	let folder = $state('all');
	let unread = $state(false);
	let attachments = $state(false);
	$effect(() => {
		if (open && dialog && !dialog.open) {
			words = query;
			dialog.showModal();
		} else if (!open && dialog?.open) dialog.close();
	});
	function search(event: SubmitEvent) {
		event.preventDefault();
		const parts = [words.trim()];
		for (const [key, value] of Object.entries({ from, to, subject, filename, label })) {
			if (value.trim()) parts.push(`${key}:${searchValue(value.trim())}`);
		}
		if (after) parts.push(`after:${after}`);
		if (before) parts.push(`before:${before}`);
		if (folder !== 'all') parts.push(`in:${folder}`);
		if (unread) parts.push('is:unread');
		if (attachments) parts.push('has:attachment');
		onSearch(parts.filter(Boolean).join(' '));
		open = false;
	}
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby={`${dialogId}-title`} data-overlay={open ? true : undefined}>
	<form onsubmit={search}>
		<header><div><h2 id={`${dialogId}-title`}>Find the right message</h2><p>Search across your mailbox.</p></div><button type="button" class="icon-btn" aria-label="Close search options" onclick={() => (open = false)}><Icon name="close-line" size={20} /></button></header>
		<div class="fields">
			<label>From<input bind:value={from} placeholder="Sender name or email" /></label>
			<label>To<input bind:value={to} placeholder="Recipient name or email" /></label>
			<label>Subject<input bind:value={subject} placeholder="Subject contains…" /></label>
			<label>Has the words<input bind:value={words} placeholder="Words or search operators" /></label>
			<label>Filename<input bind:value={filename} placeholder="e.g. proposal.pdf" /></label>
			<label>Label<input bind:value={label} placeholder="Label name" /></label>
			<label>Search in<select bind:value={folder}><option value="all">All mail</option><option value="inbox">Inbox</option><option value="sent">Sent</option><option value="drafts">Drafts</option><option value="starred">Starred</option><option value="snoozed">Snoozed</option><option value="spam">Spam</option><option value="trash">Trash</option><option value="anywhere">Anywhere, including Spam and Trash</option></select></label>
			<div class="dates"><label>On or after<input type="date" bind:value={after} max={before || undefined} /></label><label>Before<input type="date" bind:value={before} min={after || undefined} /></label></div>
		</div>
		<div class="checks"><label><input type="checkbox" bind:checked={attachments} /> Has attachments</label><label><input type="checkbox" bind:checked={unread} /> Unread only</label></div>
		<footer><p>Try <code>from:alex has:attachment</code> in the search bar.</p><button class="btn-primary" type="submit"><Icon name="search-line" size={17} />Search</button></footer>
	</form>
</dialog>

<style>
	dialog { width: min(36rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 1.5rem; border: 1px solid var(--color-line); border-radius: 22px; background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-float); }
	dialog::backdrop { background: var(--color-scrim); backdrop-filter: blur(3px); }
	header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.03em; }
	header p { color: var(--color-text-secondary); margin-top: 0.25rem; }
	.fields { display: grid; gap: 0.8rem; }
	.fields > label { display: grid; grid-template-columns: 6.5rem minmax(0,1fr); align-items: center; gap: 0.75rem; }
	label { font-size: 0.8125rem; color: var(--color-text-secondary); }
	input:not([type='checkbox']), select { min-width: 0; width: 100%; min-height: 2.5rem; padding: 0.5rem 0.7rem; border: 1px solid var(--color-line-strong); border-radius: 9px; color: var(--color-text); background: var(--color-well); }
	input::placeholder { color: var(--color-muted); }
	.dates { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.25rem; }
	.dates label { display: grid; gap: 0.4rem; }
	.checks { display: flex; gap: 1.5rem; padding: 1.25rem 0; }
	.checks label { display: flex; align-items: center; gap: 0.5rem; }
	input[type='checkbox'] { accent-color: var(--color-accent); width: 1rem; height: 1rem; }
	footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--color-line); padding-top: 1rem; }
	footer p { font-size: 0.75rem; color: var(--color-text-secondary); }
	code { display: block; margin-top: 0.25rem; font-size: 0.7rem; }
	@media(max-width: 480px) { dialog { padding: 1.1rem; } .fields > label { grid-template-columns: 1fr; gap: 0.3rem; } footer p { display: none; } footer { justify-content: flex-end; } }
</style>

<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import { requireOk, requestError } from '$lib/utils/request';
	import type { MailLabel } from '$lib/types';
	let { labels, collapsed = false }: { labels: MailLabel[]; collapsed?: boolean } = $props();
	let dialog = $state<HTMLDialogElement>();
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	async function create(event: SubmitEvent) {
		event.preventDefault(); if (busy || !name.trim()) return;
		busy = true; error = '';
		try {
			await requireOk(await fetch('/api/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }));
			name = ''; await invalidateAll();
		} catch (cause) { error = requestError(cause); } finally { busy = false; }
	}
	async function remove(label: MailLabel) {
		if (busy) return; busy = true; error = '';
		try {
			await requireOk(await fetch(`/api/labels/${label.id}`, { method: 'DELETE' }));
			if ($page.url.searchParams.get('label') === label.id) await goto('/all');
			else await invalidateAll();
		} catch (cause) { error = requestError(cause); } finally { busy = false; }
	}
</script>

<button type="button" class="manage" class:collapsed aria-label="Manage labels" title="Manage labels" onclick={() => { error = ''; dialog?.showModal(); }}>
	{#if !collapsed}<span>Labels</span>{/if}<Icon name="add-line" size={18} />
</button>
<dialog bind:this={dialog} aria-labelledby="manage-labels-title">
	<header><div><h2 id="manage-labels-title">Your labels</h2><p>Give conversations a place of their own.</p></div><button type="button" class="icon-btn" aria-label="Close label manager" onclick={() => dialog?.close()}><Icon name="close-line" size={20} /></button></header>
	<form onsubmit={create}><label for="new-label">New label</label><div class="new-label"><input id="new-label" bind:value={name} placeholder="e.g. Projects" maxlength="60" required disabled={busy} /><button type="submit" class="btn-primary" disabled={busy || !name.trim()}>Create</button></div></form>
	{#if error}<p role="alert" class="error">{error}</p>{/if}
	{#if labels.length}
		<ul>{#each labels as label (label.id)}<li><Icon name="price-tag-3-line" size={17} /><span>{label.name}</span><button type="button" class="icon-btn" aria-label={`Remove label ${label.name}`} title="Remove label" disabled={busy} onclick={() => remove(label)}><Icon name="delete-bin-line" size={17} /></button></li>{/each}</ul>
	{:else}<p class="empty">Create a label, then apply it to messages from the mailbox toolbar.</p>{/if}
	<footer>Removing a label keeps the messages.</footer>
</dialog>

<style>
	.manage { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 0.6rem 0.875rem; color: var(--color-text-secondary); font-size: 0.75rem; font-weight: 600; }
	.manage:hover { color: var(--color-accent-text); }
	.manage.collapsed { justify-content: center; height: 2.5rem; padding: 0; border-radius: 12px; }
	dialog { width: min(30rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 1.5rem; border: 1px solid var(--color-line); border-radius: 20px; color: var(--color-text); background: var(--color-surface); box-shadow: var(--mat-float); }
	dialog::backdrop { background: var(--color-scrim); backdrop-filter: blur(3px); }
	header { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	h2 { font-size: 1.2rem; font-weight: 600; letter-spacing: -0.025em; }
	header p, .empty { margin-top: 0.3rem; color: var(--color-text-secondary); font-size: 0.8125rem; }
	label { font-size: 0.75rem; color: var(--color-text-secondary); }
	.new-label { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
	input { width: 100%; min-width: 0; padding: 0.6rem 0.7rem; border: 1px solid var(--color-line); border-radius: 9px; background: var(--color-well); }
	ul { margin: 1rem 0; }
	li { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-line); color: var(--color-accent-text); }
	li span { flex: 1; overflow-wrap: anywhere; }
	footer { margin-top: 1rem; font-size: 0.75rem; color: var(--color-text-secondary); }
	.error { color: var(--color-danger); margin-top: 0.75rem; }
</style>

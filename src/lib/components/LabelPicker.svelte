<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tooltip } from '$lib/actions/tooltip';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import { requireOk, requestError } from '$lib/utils/request';
	import type { MailLabel } from '$lib/types';
	let { labels, ids, existing = [], disabled = false, caption = '' }: { labels: MailLabel[]; ids: string[]; existing?: MailLabel[][]; disabled?: boolean; caption?: string } = $props();
	const dialogId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let changes = $state<Record<string, boolean>>({});
	let busy = $state(false);
	let error = $state('');
	function initial(id: string) { return existing.length > 0 && existing.every((group) => group.some((label) => label.id === id)); }
	function mixed(id: string) { return changes[id] === undefined && !initial(id) && existing.some((group) => group.some((label) => label.id === id)); }
	async function apply(event: SubmitEvent) {
		event.preventDefault(); if (busy) return; busy = true; error = '';
		try {
			await requireOk(await fetch('/api/labels/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, changes: Object.entries(changes).map(([labelId, apply]) => ({ labelId, apply })) }) }));
			await invalidateAll(); dialog?.close();
		} catch (cause) { error = requestError(cause); } finally { busy = false; }
	}
</script>

<button type="button" class="trigger" class:caption={Boolean(caption)} aria-label={caption || 'Label conversations'} use:tooltip={caption ? '' : 'Label conversations'} disabled={disabled || !ids.length} onclick={() => { changes = {}; error = ''; dialog?.showModal(); }}><Icon name="price-tag-3-line" size={19} />{#if caption}<span>{caption}</span>{/if}</button>
<dialog bind:this={dialog} aria-labelledby={`${dialogId}-title`}>
	<form onsubmit={apply}>
		<header><div><h2 id={`${dialogId}-title`}>Label conversations</h2><p>{ids.length} conversation{ids.length === 1 ? '' : 's'} selected</p></div><button type="button" class="icon-btn" aria-label="Close label picker" onclick={() => dialog?.close()}><Icon name="close-line" size={20} /></button></header>
		{#if labels.length}
			<div class="labels">{#each labels as label (label.id)}<Check label={label.name} caption={label.name} checked={changes[label.id] ?? initial(label.id)} indeterminate={mixed(label.id)} disabled={busy} onchange={(next) => { changes = { ...changes, [label.id]: next }; }} />{/each}</div>
		{:else}<p class="empty">Create a label using the + beside Labels in the sidebar.</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<footer><button type="button" class="btn-ghost" onclick={() => dialog?.close()}>Cancel</button><button type="submit" class="btn-primary" disabled={busy || !Object.keys(changes).length}>{busy ? 'Applying…' : 'Apply'}</button></footer>
	</form>
</dialog>

<style>
	.trigger { display: flex; align-items: center; justify-content: center; width: 2.125rem; height: 2.125rem; border-radius: 9px; color: var(--color-text-secondary); }
	.trigger:hover:not(:disabled) { background: var(--color-well); }
	.trigger:disabled { opacity: 0.4; }
	.trigger.caption { width: 100%; height: auto; min-height: 2.75rem; justify-content: flex-start; gap: 0.65rem; padding: 0.65rem 0.75rem; font-size: 0.8125rem; text-align: left; }
	dialog { width: min(25rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 1.4rem; border: 1px solid var(--color-line); border-radius: 20px; background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-float); }
	dialog::backdrop { background: var(--color-scrim); backdrop-filter: blur(3px); }
	header { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
	h2 { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.025em; }
	header p { margin-top: 0.25rem; font-size: 0.75rem; color: var(--color-text-secondary); }
	.labels { display: flex; flex-direction: column; gap: 0.35rem; max-height: 45dvh; overflow-y: auto; }
	.labels :global(.check) { justify-content: flex-start; min-height: 2.75rem; overflow-wrap: anywhere; text-align: left; }
	.empty { color: var(--color-text-secondary); font-size: 0.8125rem; }
	footer { display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--color-line); padding-top: 1rem; margin-top: 1rem; }
	.error { color: var(--color-danger); font-size: 0.8125rem; margin-top: 0.75rem; }
</style>

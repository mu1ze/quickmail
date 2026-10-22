<script lang="ts">
	import Icon from './Icon.svelte';
	import { prepareAccountChange, switchAccount, type BrowserAccount } from '$lib/account-client';
	let { user, accounts, compact = false, responsive = false, onLogout }: {
		user: BrowserAccount; accounts: BrowserAccount[]; compact?: boolean; responsive?: boolean; onLogout: (all?: boolean) => Promise<void>;
	} = $props();
	let dialog: HTMLDialogElement;
	let busy = $state(false);
	let error = $state('');
	const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
	async function act(action: () => Promise<void>) {
		busy = true; error = '';
		try { await action(); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not change accounts. Please try again.'; busy = false; }
	}
</script>

<button type="button" class="account-trigger" class:compact class:responsive aria-label={`Switch account: ${user.email}`} title="Switch account" aria-haspopup="dialog" onclick={() => { error = ''; dialog.showModal(); }}>
	<span class="avatar">{initials(user.name)}</span>
	{#if !compact}<span class="identity"><strong>{user.name}</strong><span>{user.email}</span></span><Icon name="expand-up-down-line" size={15} />{/if}
</button>

<dialog bind:this={dialog} aria-label="Switch account" oncancel={(event) => { if (busy) event.preventDefault(); }} onpointerdown={(event) => {
	if (busy || event.target !== dialog) return;
	const bounds = dialog.getBoundingClientRect();
	if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
}}>
	<div class="sheet-handle" aria-hidden="true"></div>
	<div class="heading"><div><h2>Your accounts</h2><p>Signed in on this browser</p></div><button type="button" class="close" aria-label="Close account switcher" disabled={busy} onclick={() => dialog.close()}><Icon name="close-line" size={20} /></button></div>
	<div class="accounts">
		{#each accounts as account (account.id)}
			<button type="button" class="account-row" class:current={account.id === user.id} aria-label={`${account.name}, ${account.email}${account.id === user.id ? ', current account' : ''}`} disabled={busy || account.id === user.id} onclick={() => act(() => switchAccount(account.id))}>
				<span class="avatar">{initials(account.name)}</span><span class="identity"><strong>{account.name}</strong><span>{account.email}</span></span>
				{#if account.id === user.id}<span class="current-label">Current</span><Icon name="check-line" size={18} />{:else}<Icon name="arrow-right-s-line" size={18} />{/if}
			</button>
		{/each}
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="actions">
		<button type="button" disabled={busy} onclick={() => act(async () => { await prepareAccountChange(); window.location.href = '/login?add=1'; })}><Icon name="user-add-line" size={18} />Add another account</button>
		<a href="/settings" onclick={(event) => { if (busy) event.preventDefault(); else dialog.close(); }}><Icon name="user-settings-line" size={18} />Account settings</a>
		<button type="button" disabled={busy} onclick={() => act(() => onLogout())}><Icon name="logout-box-r-line" size={18} />Sign out of this account</button>
		{#if accounts.length > 1}<button type="button" disabled={busy} onclick={() => act(() => onLogout(true))}><Icon name="logout-circle-r-line" size={18} />Sign out of all accounts</button>{/if}
	</div>
	{#if busy}<p class="status" role="status">Updating your accounts…</p>{/if}
</dialog>

<style>
	.account-trigger { display: flex; align-items: center; gap: 0.625rem; width: 100%; padding: 0.5rem; border-radius: 12px; text-align: left; color: var(--color-text); }
	.account-trigger:hover { background: var(--color-surface-hover); }
	.account-trigger.compact { justify-content: center; width: 2.75rem; min-height: 2.75rem; padding: 0.25rem; margin-inline: auto; }
	.avatar { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 2.125rem; height: 2.125rem; border-radius: 11px; background: var(--color-accent-soft); color: var(--color-accent-text); font-size: 0.75rem; font-weight: 600; }
	.identity { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 0.15rem; }
	.identity strong { font-size: 0.8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.identity > span { font-size: 0.6875rem; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	dialog { width: min(26rem, calc(100vw - 2rem)); max-height: calc(100dvh - 3rem); margin: auto; padding: 0; overflow: hidden; border: 1px solid var(--color-line); border-radius: 20px; background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-float); }
	dialog[open] { display: flex; flex-direction: column; }
	.sheet-handle { display: none; }
	dialog::backdrop { background: rgb(0 0 0 / 35%); backdrop-filter: blur(3px); }
	.heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.25rem 1rem; }
	h2 { margin: 0; font-size: 1.0625rem; font-weight: 600; }
	.heading p { margin: 0.3rem 0 0; font-size: 0.75rem; color: var(--color-text-secondary); }
	.close { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 10px; }
	.close:hover { background: var(--color-well); }
	.accounts { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 0.5rem 0.5rem; }
	.account-row { display: flex; align-items: center; gap: 0.75rem; width: 100%; min-height: 4.25rem; padding: 0.75rem; border-radius: 12px; text-align: left; }
	.account-row:hover { background: var(--color-well); }
	.account-row.current { background: var(--color-accent-soft); opacity: 1; }
	.current-label { font-size: 0.625rem; color: var(--color-accent-text); }
	.actions { display: flex; flex-shrink: 0; flex-direction: column; padding: 0.5rem; border-top: 1px solid var(--color-line); }
	.actions button, .actions a { display: flex; align-items: center; gap: 0.75rem; min-height: 2.75rem; padding: 0.625rem 0.75rem; font-size: 0.8125rem; text-align: left; border-radius: 9px; }
	.actions button:hover, .actions a:hover { background: var(--color-well); }
	.error, .status { flex-shrink: 0; margin: 0; padding: 0.75rem 1.25rem; font-size: 0.8125rem; }
	.error { color: var(--color-danger, #b42318); }
	.status { color: var(--color-text-secondary); }
	button:disabled:not(.current) { opacity: 0.5; cursor: wait; }
	@media (max-width: 900px) {
		.responsive .identity { display: none; }
		dialog { width: min(26rem, calc(100vw - 1.5rem)); max-height: calc(100dvh - max(0.75rem, env(safe-area-inset-top)) - max(0.75rem, env(safe-area-inset-bottom))); margin: auto auto max(0.75rem, env(safe-area-inset-bottom)); }
		.sheet-handle { display: block; flex-shrink: 0; width: 2rem; height: 0.25rem; margin: 0.5rem auto 0; border-radius: 2px; background: var(--color-line-strong); }
		.heading { padding-top: 0.5rem; padding-bottom: 0.75rem; }
	}
</style>

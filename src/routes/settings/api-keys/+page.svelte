<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Check from '$lib/components/Check.svelte';
	import CopyButton from '$lib/interior/CopyButton.svelte';
	import type { ApiTokenSummary } from '$lib/types';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let keyName = $state('');
	let sendScope = $state(true);
	let readScope = $state(true);
	let adminScope = $state(false);
	let tokens = $state<ApiTokenSummary[]>([]);
	let hydrated = $state(false);
	$effect(() => {
		if (!hydrated) {
			tokens = data.apiTokens;
			hydrated = true;
		}
	});
	let keyBusy = $state(false);
	let keyError = $state('');
	let creating = $state(false);
	let revealed = $state<{ summary: ApiTokenSummary; token: string } | null>(null);
	let installCopied = $state(false);
	const installCommand =
		'curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickmail/main/scripts/install.sh | sh';

	const canCreateKey = $derived(
		Boolean(keyName.trim()) && (sendScope || readScope || (data.isAdmin && adminScope))
	);

	function openCreate() {
		keyName = '';
		sendScope = true;
		readScope = true;
		adminScope = false;
		keyError = '';
		revealed = null;
		creating = true;
	}

	function closeCreate() {
		creating = false;
		revealed = null;
		keyError = '';
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (creating && event.key === 'Escape' && !revealed) closeCreate();
	}

	async function createKey(event?: SubmitEvent) {
		if (event) event.preventDefault();
		keyBusy = true;
		keyError = '';
		try {
			const scopes = [];
			if (sendScope) scopes.push('mail:send');
			if (readScope) scopes.push('mail:read');
			if (data.isAdmin && adminScope) scopes.push('admin');

			const res = await fetch('/api/apikeys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: keyName, scopes })
			});
			const body = await res.json();
			if (!res.ok) {
				keyError = body.error ?? 'Could not create the API key';
				return;
			}
			tokens = [body.tokenMeta, ...tokens.filter((token) => token.id !== body.tokenMeta.id)];
			revealed = { summary: body.tokenMeta, token: body.token };
			keyName = '';
		} catch {
			keyError = 'Network error';
		} finally {
			keyBusy = false;
		}
	}

	async function copyInstall() {
		try {
			await navigator.clipboard.writeText(installCommand);
			installCopied = true;
			setTimeout(() => (installCopied = false), 1600);
		} catch {
			/* clipboard unavailable — the command is still selectable */
		}
	}

	async function revokeKey(id: string) {
		if (!confirm('Revoke this key?')) return;
		const res = await fetch(`/api/apikeys/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			keyError = body.error ?? 'Could not revoke that key';
			return;
		}
		tokens = body.tokens;
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>API keys — Settings</title>
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<HubShell title="API keys" backHref="/settings">
	<GroupedPanel>
		<div class="panel-head">
			<button type="button" class="btn-primary" onclick={openCreate}>
				<Icon name="add-line" size={15} />
				New
			</button>
		</div>

		{#if tokens.length}
			<ul class="key-list">
				{#each tokens as token (token.id)}
					<li class="key-row">
						<div class="min-w-0 flex-1">
							<p class="key-name">{token.name}</p>
							<p class="key-meta">
								<code>{token.preview}</code>
								<span class="caps">
									{#each token.scopes as scope (scope)}<span class="chip">{scope}</span>{/each}
								</span>
							</p>
						</div>
						<span class="key-created">{formatDate(token.created_at)}</span>
						<button
							type="button"
							class="icon-btn"
							aria-label="Revoke {token.name}"
							onclick={() => revokeKey(token.id)}
						>
							<Icon name="delete-bin-line" size={15} />
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">No keys</p>
		{/if}

		{#if keyError && !creating}<p class="error">{keyError}</p>{/if}

		<div class="install-row">
			<code>{installCommand}</code>
			<button type="button" class="icon-btn" aria-label="Copy install command" onclick={copyInstall}>
				<Icon name={installCopied ? 'check-line' : 'file-copy-line'} size={15} />
			</button>
		</div>
	</GroupedPanel>
</HubShell>

{#if creating}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget && !revealed) closeCreate();
		}}
	>
		<div
			class="key-modal"
			role="dialog"
			aria-modal="true"
			aria-label={revealed ? 'Copy API key' : 'New API key'}
			tabindex="-1"
		>
			<div class="modal-head">
				<h3>
					<Icon name="key-2-line" size={16} />
					{revealed ? 'Copy this key' : 'New API key'}
				</h3>
				<button type="button" class="icon-btn" aria-label="Close" onclick={closeCreate}>
					<Icon name="close-line" size={16} />
				</button>
			</div>

			{#if revealed}
				<p class="modal-note">Shown once. Copy it now.</p>
				<pre class="token-box">{revealed.token}</pre>
				<div class="modal-actions">
					<CopyButton value={revealed.token} label="Copy" copiedLabel="Copied" />
					<button type="button" class="btn-ghost" onclick={closeCreate}>Done</button>
				</div>
			{:else}
				<form class="key-form" onsubmit={createKey}>
					<label class="sr-only" for="apikey-name">Key name</label>
					<input
						id="apikey-name"
						class="text-input"
						placeholder="Name"
						value={keyName}
						autofocus
						oninput={(event) => (keyName = event.currentTarget.value)}
					/>

					<div class="scope-row">
						<Check label="Send mail" caption="send" checked={sendScope} onchange={(next) => (sendScope = next)} />
						<Check label="Read mail" caption="read" checked={readScope} onchange={(next) => (readScope = next)} />
						{#if data.isAdmin}
							<Check
								label="Admin"
								caption="admin"
								checked={adminScope}
								onchange={(next) => (adminScope = next)}
							/>
						{/if}
					</div>

					{#if keyError}<p class="error">{keyError}</p>{/if}

					<div class="modal-actions">
						<button type="button" class="btn-ghost" onclick={closeCreate}>Cancel</button>
						<button type="submit" class="btn-primary" disabled={keyBusy || !canCreateKey}>
							{keyBusy ? 'Creating…' : 'Create'}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.panel-head {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.5rem;
	}

	.key-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.key-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0;
	}

	.key-row + .key-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.key-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.key-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.key-meta code {
		font-size: 0.75rem;
	}

	.caps {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-well);
	}

	.key-created {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.empty {
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.install-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.install-row code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-scrim);
	}

	.key-modal {
		width: 100%;
		max-width: 26rem;
		padding: 1.25rem 1.375rem 1.375rem;
		border-radius: 1.25rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.modal-head h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.modal-note {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.token-box {
		overflow-x: auto;
		margin-top: 0.875rem;
		padding: 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		word-break: break-all;
		white-space: pre-wrap;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.875rem;
	}

	.key-form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin-top: 1rem;
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input::placeholder {
		color: var(--color-muted);
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.scope-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>

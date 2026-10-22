<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import FloatingField from '$lib/interior/FloatingField.svelte';
	import LoadingButton from '$lib/interior/LoadingButton.svelte';
	import { finishAccountChange, switchAccount } from '$lib/account-client';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const adding = $derived(data.user !== null);

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});
			const result = await res.json();
			if (!res.ok) {
				error = result.error ?? 'Login failed';
				return;
			}
			await finishAccountChange(result.user.id);
		} catch {
			error = 'Network error';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — Mail</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>{adding ? 'Add another account' : 'Sign in'}</h1>
			{#if adding}<p class="auth-note">Your other accounts will stay signed in.</p>{/if}
		</div>

		<form class="login-form" onsubmit={submit}>
			<FloatingField id="email" label="Email" type="email" autocomplete="username" bind:value={email} required />
			<FloatingField
				id="password"
				label="Password"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
				invalid={Boolean(error)}
				message={error}
			/>

			<div class="login-action">
				<LoadingButton
					type="submit"
					tone="accent"
					label="Continue"
					status={loading ? 'pending' : error ? 'error' : 'idle'}
					pendingLabel="Signing in"
					errorLabel="Try again"
					disabled={loading}
				/>
			</div>
		</form>

		{#if adding}<p class="auth-alt"><a href="/inbox">Back to {data.user?.name || 'your inbox'}</a> · <a href="/recover?add=1">Forgot password</a></p>{:else}<p class="auth-alt"><a href="/recover">Forgot password</a></p>{/if}
		{#if data.accounts.length > 0}
			<div class="saved-accounts"><p>Already signed in</p>{#each data.accounts as account (account.id)}<button type="button" disabled={loading} onclick={async () => { loading = true; error = ''; try { await switchAccount(account.id); } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not switch accounts'; loading = false; } }}>{account.name}<span>{account.email}</span></button>{/each}</div>
		{/if}
	</div>
</div>

<style>
	.auth-note { margin: 0.75rem 0 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.saved-accounts { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--color-line); }
	.saved-accounts p { font-size: 0.75rem; color: var(--color-text-secondary); margin-bottom: 0.5rem; }
	.saved-accounts button { display: flex; flex-direction: column; width: 100%; gap: 0.25rem; padding: 0.75rem; border-radius: 10px; font-size: 0.875rem; text-align: left; }
	.saved-accounts button:hover { background: var(--color-well); }
	.saved-accounts span { font-size: 0.75rem; color: var(--color-text-secondary); }
	.auth-brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		border-radius: 14px;
		box-shadow: var(--mat-panel);
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 1.75rem;
	}

	.login-action :global(.loading-btn) {
		width: 100%;
	}

	.auth-alt {
		margin: 1.25rem 0 0;
		text-align: center;
		font-size: 0.875rem;
	}

	.auth-alt a {
		color: var(--color-ink-muted);
	}
</style>

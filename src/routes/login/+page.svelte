<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import FloatingField from '$lib/interior/FloatingField.svelte';
	import LoadingButton from '$lib/interior/LoadingButton.svelte';
	import { discardPushSubscriptionFromAnotherAccount } from '$lib/push-client';

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
			const data = await res.json();
			if (!res.ok) {
				error = data.error ?? 'Login failed';
				return;
			}
			try {
				await discardPushSubscriptionFromAnotherAccount();
			} catch (pushError) {
				console.warn('Could not reconcile the existing push subscription after login', pushError);
			}
			window.location.href = '/inbox';
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
			<h1>Sign in</h1>
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
	</div>
</div>

<style>
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
</style>

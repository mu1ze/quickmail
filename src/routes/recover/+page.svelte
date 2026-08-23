<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import FloatingField from '$lib/interior/FloatingField.svelte';
	import LoadingButton from '$lib/interior/LoadingButton.svelte';

	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let recoveryKey = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (password !== confirm) {
			error = 'New passwords do not match';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/recover', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, recoveryKey })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error ?? 'Could not update password';
				return;
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
	<title>Reset password — Mail</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>Reset password</h1>
			<p class="auth-copy">Set a new password for an existing account. Mail stays in place.</p>
		</div>

		<form class="login-form" onsubmit={submit}>
			<FloatingField id="email" label="Email" type="email" autocomplete="username" bind:value={email} required />
			<FloatingField
				id="recovery-key"
				label="Recovery key"
				type="password"
				autocomplete="off"
				bind:value={recoveryKey}
				required
			/>
			<FloatingField
				id="password"
				label="New password"
				type="password"
				autocomplete="new-password"
				bind:value={password}
				required
			/>
			<FloatingField
				id="confirm"
				label="Confirm password"
				type="password"
				autocomplete="new-password"
				bind:value={confirm}
				required
				invalid={Boolean(error)}
				message={error}
			/>

			<div class="login-action">
				<LoadingButton
					type="submit"
					tone="accent"
					label="Save password"
					status={loading ? 'pending' : error ? 'error' : 'idle'}
					pendingLabel="Saving"
					errorLabel="Try again"
					disabled={loading}
				/>
			</div>
		</form>

		<p class="auth-alt"><a href="/login">Back to sign in</a></p>
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

	.auth-copy {
		margin: 0.5rem 0 0;
		max-width: 20rem;
		color: var(--color-ink-muted);
		font-size: 0.875rem;
		line-height: 1.4;
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

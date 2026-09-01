<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let passwordError = $state('');
	let passwordSaved = $state(false);

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		passwordBusy = true;
		passwordError = '';
		passwordSaved = false;

		if (newPassword !== confirmPassword) {
			passwordError = 'New passwords do not match';
			passwordBusy = false;
			return;
		}

		try {
			const res = await fetch('/api/settings/password', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const body = await res.json();
			if (!res.ok) {
				passwordError = body.error ?? 'Could not change password';
				return;
			}

			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			passwordSaved = true;
		} catch {
			passwordError = 'Network error';
		} finally {
			passwordBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Password — Settings</title>
</svelte:head>

<HubShell title="Password" backHref="/settings">
	<GroupedPanel
		hint="Other signed-in devices will be signed out. API keys are revoked and must be created again."
	>
		<form class="password-form" onsubmit={changePassword}>
			<label class="field-title" for="current-password">Current password</label>
			<input
				id="current-password"
				type="password"
				class="text-input"
				bind:value={currentPassword}
				required
				autocomplete="current-password"
			/>

			<label class="field-title" for="new-password">New password</label>
			<input
				id="new-password"
				type="password"
				class="text-input"
				bind:value={newPassword}
				required
				minlength="12"
				autocomplete="new-password"
			/>

			<label class="field-title" for="confirm-password">Confirm new password</label>
			<input
				id="confirm-password"
				type="password"
				class="text-input"
				bind:value={confirmPassword}
				required
				minlength="12"
				autocomplete="new-password"
			/>

			<div class="password-actions">
				<button
					type="submit"
					class="btn-primary"
					disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
				>
					{passwordBusy ? 'Saving…' : 'Change password'}
				</button>
			</div>

			{#if passwordError}<p class="error">{passwordError}</p>{/if}
			{#if passwordSaved}<p class="saved">Password updated</p>{/if}
		</form>
	</GroupedPanel>
</HubShell>

<style>
	.password-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-title {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.password-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.saved {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { enablePushNotifications, supportsWebPush } from '$lib/push-client';

	let { publicKey }: { publicKey: string | null } = $props();

	const DISMISSED_KEY = 'mail:notify-prompt';
	let visible = $state(false);
	let busy = $state(false);
	let message = $state('');

	onMount(() => {
		// Only when this device can receive push and hasn't been asked yet. On an
		// iPhone that means the home-screen app; Safari tabs have no web push.
		if (!publicKey || !supportsWebPush() || Notification.permission !== 'default') return;
		try {
			if (localStorage.getItem(DISMISSED_KEY)) return;
		} catch {
			/* storage unavailable: still offer */
		}
		visible = true;
	});

	function dismiss() {
		visible = false;
		try {
			localStorage.setItem(DISMISSED_KEY, 'dismissed');
		} catch {
			/* ignore */
		}
	}

	async function enable() {
		if (!publicKey) return;
		busy = true;
		message = '';
		try {
			const permission = await enablePushNotifications(publicKey);
			if (permission === 'granted') {
				message = 'Notifications are on for this device.';
				setTimeout(() => (visible = false), 2200);
			} else if (permission === 'denied') {
				message = 'Notifications are blocked. You can allow them in your device settings.';
				dismiss();
			}
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Could not turn on notifications';
		} finally {
			busy = false;
		}
	}
</script>

{#if visible}
	<div class="prompt" role="region" aria-label="Notifications">
		<span class="prompt-icon" aria-hidden="true"><Icon name="notification-3-line" size={18} /></span>
		<div class="prompt-text">
			<p class="prompt-title">Get notified about new mail</p>
			<p class="prompt-detail">{message || 'Turn on notifications for this device. You can choose which mail notifies you in Settings.'}</p>
		</div>
		<div class="prompt-actions">
			<button type="button" class="btn-primary" disabled={busy} onclick={enable}>{busy ? 'Turning on…' : 'Turn on'}</button>
			<button type="button" class="icon-btn" aria-label="Not now" disabled={busy} onclick={dismiss}><Icon name="close-line" size={16} /></button>
		</div>
	</div>
{/if}

<style>
	.prompt {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.5rem 0.75rem 0.25rem;
		padding: 0.75rem 0.75rem 0.75rem 0.875rem;
		border-radius: 14px;
		background: var(--color-accent-soft);
	}

	.prompt-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		color: var(--color-accent-text);
		background: var(--color-surface);
	}

	.prompt-text {
		flex: 1;
		min-width: 0;
	}

	.prompt-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.prompt-detail {
		margin-top: 0.1rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.prompt-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	@media (max-width: 900px) {
		.prompt {
			margin: 0.25rem 1rem 0.5rem;
		}
	}
</style>

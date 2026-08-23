<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';

	type SenderSound = { sender: string; sound: string };
	type BrrrView = {
		configured: boolean;
		preview: string | null;
		defaultSound: string;
		senderSounds: SenderSound[];
	};
	type SoundOption = { value: string; label: string };

	let {
		initial,
		sounds
	}: {
		initial: BrrrView;
		sounds: SoundOption[];
	} = $props();

	let settings = $state<BrrrView>(untrack(() => initial));
	let webhook = $state('');
	let defaultSound = $state(untrack(() => initial.defaultSound));
	let senderSounds = $state<SenderSound[]>(
		untrack(() => initial.senderSounds.map((rule) => ({ ...rule })))
	);
	let busy = $state(false);
	let testBusy = $state(false);
	let error = $state('');
	let notice = $state('');

	function applyView(view: BrrrView) {
		settings = view;
		webhook = '';
		defaultSound = view.defaultSound;
		senderSounds = view.senderSounds.map((rule) => ({ ...rule }));
	}

	function addSender() {
		senderSounds = [...senderSounds, { sender: '', sound: defaultSound }];
	}

	function removeSender(index: number) {
		senderSounds = senderSounds.filter((_, i) => i !== index);
	}

	async function readError(res: Response): Promise<string> {
		try {
			const body = (await res.json()) as { error?: string };
			return body.error ?? 'Request failed';
		} catch {
			return 'Request failed';
		}
	}

	async function saveDestination() {
		busy = true;
		error = '';
		notice = '';
		try {
			const payload: {
				webhook?: string;
				defaultSound: string;
				senderSounds: SenderSound[];
			} = {
				defaultSound,
				senderSounds: senderSounds
					.map((rule) => ({ sender: rule.sender.trim(), sound: rule.sound }))
					.filter((rule) => rule.sender.length > 0)
			};
			if (webhook.trim()) payload.webhook = webhook.trim();

			const res = await fetch('/api/settings/brrr', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				error = await readError(res);
				return;
			}
			applyView((await res.json()) as BrrrView);
			notice = 'Brrr destination saved';
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}

	async function sendTest() {
		testBusy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/brrr/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sound: defaultSound })
			});
			if (!res.ok) {
				error = await readError(res);
				return;
			}
			notice = 'Test notification sent';
		} catch {
			error = 'Network error';
		} finally {
			testBusy = false;
		}
	}

	async function removeDestination() {
		busy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/brrr', { method: 'DELETE' });
			if (!res.ok) {
				error = await readError(res);
				return;
			}
			applyView((await res.json()) as BrrrView);
			notice = 'Brrr destination removed';
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}
</script>

<section class="surface-lg card">
	<div class="card-head">
		<div>
			<h2><Icon name="smartphone-line" size={18} /> Phone notifications</h2>
			<p class="section-description">
				Ping your phone through
				<a href="https://brrr.now" target="_blank" rel="noreferrer">Brrr</a>
				when new mail arrives. Desktop notifications still work in this browser.
			</p>
		</div>
		<span class="badge" class:notification-on={settings.configured}>
			{settings.configured ? 'On' : 'Off'}
		</span>
	</div>

	<p class="hint">
		<Icon name="information-line" size={14} />
		Paste the webhook from the Brrr app. The shared webhook reaches every device; a device webhook
		reaches one phone.
	</p>

	{#if settings.configured && settings.preview}
		<p class="preview">Saved destination: <code>{settings.preview}</code></p>
	{/if}

	<label class="field-title" for="brrr-webhook">
		{settings.configured ? 'Replace webhook (optional)' : 'Webhook'}
	</label>
	<input
		id="brrr-webhook"
		class="text-input"
		type="text"
		autocomplete="off"
		spellcheck="false"
		placeholder="https://api.brrr.now/v1/br_usr_… or br_usr_…"
		bind:value={webhook}
	/>

	<label class="field-title" for="brrr-default-sound">Default sound</label>
	<select id="brrr-default-sound" class="text-input" bind:value={defaultSound}>
		{#each sounds as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>

	<div class="sender-head">
		<p class="field-title sender-title">Sounds for specific senders</p>
		<button type="button" class="btn-ghost add-sender" onclick={addSender}>Add sender</button>
	</div>
	<p class="hint sender-hint">Match the From address. Everyone else uses the default sound.</p>

	{#if senderSounds.length === 0}
		<p class="hint empty-senders">No sender overrides yet.</p>
	{:else}
		<ul class="sender-list">
			{#each senderSounds as rule, index (index)}
				<li class="sender-row">
					<input
						class="text-input"
						type="email"
						autocomplete="off"
						placeholder="alerts@example.com"
						aria-label="Sender email"
						bind:value={rule.sender}
					/>
					<select class="text-input" aria-label="Sender sound" bind:value={rule.sound}>
						{#each sounds as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
					<button type="button" class="btn-ghost" onclick={() => removeSender(index)}>Remove</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="actions">
		<button
			type="button"
			class="btn-primary"
			disabled={busy || (!settings.configured && !webhook.trim())}
			onclick={saveDestination}
		>
			{busy ? 'Saving…' : 'Save'}
		</button>
		<button
			type="button"
			class="btn-ghost"
			disabled={busy || testBusy || !settings.configured}
			onclick={sendTest}
		>
			{testBusy ? 'Sending…' : 'Send test'}
		</button>
		<button
			type="button"
			class="btn-ghost"
			disabled={busy || !settings.configured}
			onclick={removeDestination}
		>
			Remove
		</button>
	</div>

	{#if error}<p class="error" aria-live="polite">{error}</p>{/if}
	{#if notice}<p class="saved" aria-live="polite">{notice}</p>{/if}
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.section-description {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.section-description a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-surface-muted);
		white-space: nowrap;
	}

	.notification-on {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.preview {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
	}

	.preview code {
		font-size: 0.8125rem;
	}

	.field-title {
		display: block;
		margin-top: 0.875rem;
		margin-bottom: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.sender-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.875rem;
	}

	.sender-title {
		margin: 0;
	}

	.add-sender {
		flex-shrink: 0;
	}

	.sender-hint,
	.empty-senders {
		margin-top: 0.375rem;
	}

	.sender-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.sender-row {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}

	@media (max-width: 640px) {
		.sender-row {
			grid-template-columns: 1fr;
		}
	}
</style>

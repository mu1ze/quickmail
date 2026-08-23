<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import SignaturePreview from './SignaturePreview.svelte';
	import {
		compileSignature,
		parseSignatureConfig,
		serializeSignatureConfig,
		type SignatureConfig,
		type SignatureLayout,
		type SignatureSocialKind
	} from '$lib/signature-template';

	let {
		value = $bindable(''),
		disabled = false,
		compact = false,
		placeholderName = '',
		onsave
	}: {
		value?: string;
		disabled?: boolean;
		compact?: boolean;
		placeholderName?: string;
		onsave?: (next: string) => void | Promise<void>;
	} = $props();

	let config = $state<SignatureConfig>(parseSignatureConfig(value));
	let uploadError = $state('');
	let uploading = $state(false);
	let lastValue = value;

	const compiled = $derived(compileSignature(config, $page.url.origin));

	$effect(() => {
		if (value !== lastValue) {
			config = parseSignatureConfig(value);
			lastValue = value;
		}
	});

	function commit(next: SignatureConfig) {
		config = next;
		const stored = serializeSignatureConfig(next);
		lastValue = stored;
		value = stored;
	}

	function patch(partial: Partial<SignatureConfig>) {
		commit({ ...config, ...partial });
	}

	const layouts: { id: SignatureLayout; label: string; hint: string }[] = [
		{ id: 'stacked', label: 'Stacked', hint: 'Name, then details' },
		{ id: 'photo', label: 'Photo', hint: 'Headshot beside details' },
		{ id: 'logo', label: 'Logo', hint: 'Mark above details' },
		{ id: 'plain', label: 'Text', hint: 'A simple sign-off' }
	];

	const socialKinds: { kind: SignatureSocialKind; label: string }[] = [
		{ kind: 'linkedin', label: 'LinkedIn' },
		{ kind: 'x', label: 'X' },
		{ kind: 'github', label: 'GitHub' },
		{ kind: 'instagram', label: 'Instagram' }
	];

	async function upload(kind: 'photo' | 'logo', files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		uploadError = '';
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const res = await fetch('/api/signature-assets', { method: 'POST', body });
			const json = (await res.json()) as { error?: string; id?: string };
			if (!res.ok || !json.id) {
				uploadError = json.error ?? 'Could not upload that image';
				return;
			}
			if (kind === 'photo') patch({ photoId: json.id, layout: 'photo' });
			else patch({ logoId: json.id, layout: 'logo' });
		} catch {
			uploadError = 'Network error';
		} finally {
			uploading = false;
		}
	}

	function addSocial(kind: SignatureSocialKind) {
		if (config.socials.some((social) => social.kind === kind) || config.socials.length >= 3) return;
		patch({ socials: [...config.socials, { kind, url: '' }] });
	}

	function updateSocial(kind: SignatureSocialKind, url: string) {
		patch({
			socials: config.socials.map((social) => (social.kind === kind ? { ...social, url } : social))
		});
	}

	function removeSocial(kind: SignatureSocialKind) {
		patch({ socials: config.socials.filter((social) => social.kind !== kind) });
	}

	async function save() {
		await onsave?.(serializeSignatureConfig(config));
	}

	async function clearCustom() {
		commit(parseSignatureConfig(''));
		await onsave?.('');
	}
</script>

<div class="editor">
	<div class="layout-grid" class:compact role="radiogroup" aria-label="Signature layout">
		{#each layouts as layout (layout.id)}
			<button
				type="button"
				role="radio"
				class="layout-card"
				class:selected={config.layout === layout.id}
				aria-checked={config.layout === layout.id}
				{disabled}
				onclick={() => patch({ layout: layout.id })}
			>
				<span class="layout-name">{layout.label}</span>
				{#if !compact}
					<span class="layout-hint">{layout.hint}</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if config.layout === 'plain'}
		<label class="field wide">
			<span>Sign-off</span>
			<textarea
				class="text-input"
				rows={compact ? 3 : 4}
				value={config.text}
				{disabled}
				placeholder={'Best,\nEmmanuel'}
				oninput={(event) => patch({ text: event.currentTarget.value, layout: 'plain' })}
			></textarea>
		</label>
	{:else}
		<div class="fields">
			<label class="field">
				<span>Name</span>
				<input
					class="text-input"
					value={config.name}
					{disabled}
					placeholder={placeholderName || 'Ada Lovelace'}
					oninput={(event) => patch({ name: event.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Title</span>
				<input
					class="text-input"
					value={config.title}
					{disabled}
					placeholder="Engineer"
					oninput={(event) => patch({ title: event.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Company</span>
				<input
					class="text-input"
					value={config.company}
					{disabled}
					placeholder="Analytical Engines"
					oninput={(event) => patch({ company: event.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Phone</span>
				<input
					class="text-input"
					value={config.phone}
					{disabled}
					placeholder="+1 555 0100"
					oninput={(event) => patch({ phone: event.currentTarget.value })}
				/>
			</label>
			<label class="field wide">
				<span>Website</span>
				<input
					class="text-input"
					value={config.website}
					{disabled}
					placeholder="example.com"
					oninput={(event) => patch({ website: event.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Accent</span>
				<input
					class="color-input"
					type="color"
					value={config.accent}
					{disabled}
					aria-label="Accent color"
					oninput={(event) => patch({ accent: event.currentTarget.value })}
				/>
			</label>
		</div>

		{#if config.layout === 'photo' || config.layout === 'logo'}
			<div class="media">
				{#if config.layout === 'photo' && config.photoId}
					<img src="/s/{config.photoId}" alt="" class="photo" />
					<button type="button" class="btn-ghost" {disabled} onclick={() => patch({ photoId: null })}>
						Remove
					</button>
				{:else if config.layout === 'logo' && config.logoId}
					<img src="/s/{config.logoId}" alt="" class="logo" />
					<button type="button" class="btn-ghost" {disabled} onclick={() => patch({ logoId: null })}>
						Remove
					</button>
				{/if}
				<label class="upload">
					<Icon name="upload-2-line" size={15} />
					{uploading ? 'Uploading…' : config.layout === 'photo' ? 'Upload photo' : 'Upload logo'}
					<input
						type="file"
						accept="image/jpeg,image/png,image/webp,image/gif"
						hidden
						disabled={disabled || uploading}
						onchange={(event) =>
							upload(config.layout === 'photo' ? 'photo' : 'logo', event.currentTarget.files)}
					/>
				</label>
			</div>
			{#if uploadError}<p class="error">{uploadError}</p>{/if}
		{/if}

		<div class="socials">
			<span class="label">Links</span>
			{#each config.socials as social (social.kind)}
				<div class="social-row">
					<span class="social-kind">{socialKinds.find((item) => item.kind === social.kind)?.label}</span>
					<input
						class="text-input"
						value={social.url}
						{disabled}
						placeholder="https://"
						oninput={(event) => updateSocial(social.kind, event.currentTarget.value)}
					/>
					<button
						type="button"
						class="icon-btn"
						aria-label="Remove {social.kind}"
						{disabled}
						onclick={() => removeSocial(social.kind)}
					>
						<Icon name="close-line" size={14} />
					</button>
				</div>
			{/each}
			{#if config.socials.length < 3}
				<div class="social-add">
					{#each socialKinds.filter((item) => !config.socials.some((social) => social.kind === item.kind)) as item (item.kind)}
						<button type="button" class="btn-ghost" {disabled} onclick={() => addSocial(item.kind)}>
							{item.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div class="preview-block">
		<span class="label">Sent as</span>
		<SignaturePreview html={compiled.html} empty="Nothing will be appended yet." />
	</div>

	{#if onsave}
		<div class="editor-actions">
			{#if compact}
				<button type="button" class="btn-ghost" {disabled} onclick={clearCustom}>
					Use account signature
				</button>
			{/if}
			<button type="button" class="btn-primary" {disabled} onclick={save}>Save</button>
		</div>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 1rem;
	}

	.layout-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.layout-card {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.7rem 0.75rem;
		border-radius: 0.75rem;
		text-align: left;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.layout-card:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.layout-card.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.layout-name {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.layout-hint {
		font-size: 0.6875rem;
		color: var(--color-muted);
		line-height: 1.35;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.field.wide {
		grid-column: 1 / -1;
	}

	.text-input {
		width: 100%;
		padding: 0.55rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	textarea.text-input {
		resize: vertical;
		line-height: 1.5;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.color-input {
		height: 2.4rem;
		width: 100%;
		padding: 0.2rem;
		border-radius: 0.625rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.media {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.photo {
		width: 72px;
		height: 72px;
		object-fit: cover;
		border-radius: 0.5rem;
	}

	.logo {
		height: 36px;
		width: auto;
		max-width: 160px;
	}

	.upload {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.7rem;
		border-radius: 0.6rem;
		font-size: 0.8125rem;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.socials,
	.preview-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.label {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.social-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.social-kind {
		flex: 0 0 5.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.social-add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.editor-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.error {
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 700px) {
		.layout-grid:not(.compact),
		.fields {
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (max-width: 520px) {
		.layout-grid,
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>

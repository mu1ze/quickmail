<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import SignaturePreview from './SignaturePreview.svelte';
	import {
		compileSignature,
		parseSignatureConfig,
		serializeSignatureConfig,
		type BakedImage,
		type SignatureAnimation,
		type SignatureConfig,
		type SignatureLayout,
		type SignatureLive,
		type SignatureScriptFont,
		type SignatureSocialKind
	} from '$lib/signature-template';
	import {
		SCRIPT_FONTS,
		liveBadgeLabels,
		loadSignatureFonts,
		renderHandwrittenName,
		renderLiveBadges,
		renderLogoMotion,
		renderPhotoMotion,
		type Rendered
	} from '$lib/signature-motion';

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

	/** Renders made in this browser but not uploaded yet, keyed by their placeholder asset id. */
	let pending = $state<Record<string, { blob: Blob; url: string }>>({});
	let rendering = $state(0);
	let renderError = $state('');

	const compiled = $derived(
		compileSignature(config, $page.url.origin, {
			preview: true,
			assetUrl: (id) => pending[id]?.url ?? `${$page.url.origin}/s/${id}`
		})
	);

	// What each baked image should be rendered from; when it differs from the stored key, re-render.
	const motionSource = $derived(
		config.layout === 'photo' ? config.photoId : config.layout === 'logo' ? config.logoId : null
	);
	const motionKey = $derived(
		config.animation !== 'none' && motionSource
			? [config.layout, config.animation, motionSource, config.accent, config.matte].join('|')
			: ''
	);
	const scriptKey = $derived(
		config.layout !== 'plain' && config.script.enabled && config.name.trim()
			? [config.name.trim(), config.script.font, config.script.loop, config.accent, config.matte].join('|')
			: ''
	);
	const liveKey = $derived(
		config.layout !== 'plain' && config.live.enabled
			? [JSON.stringify(liveBadgeLabels(config.live)), config.matte].join('|')
			: ''
	);

	function keep(rendered: Rendered, key: string): BakedImage {
		const id = crypto.randomUUID();
		pending = { ...pending, [id]: { blob: rendered.blob, url: URL.createObjectURL(rendered.blob) } };
		return { id, w: rendered.w, h: rendered.h, key };
	}

	/** Renders whatever is out of date. Results for a key that changed meanwhile are dropped. */
	async function renderStale() {
		const jobs: Promise<void>[] = [];
		const run = async (job: () => Promise<void>) => {
			rendering++;
			try {
				await job();
			} catch (cause) {
				renderError = cause instanceof Error ? cause.message : 'Could not render the effect';
			} finally {
				rendering--;
			}
		};
		renderError = '';
		const mKey = motionKey;
		if (mKey && config.motion?.key !== mKey && motionSource) {
			const source = `/s/${motionSource}`;
			const effect = config.animation as Exclude<SignatureAnimation, 'none'>;
			const isPhoto = config.layout === 'photo';
			jobs.push(run(async () => {
				const out = await (isPhoto ? renderPhotoMotion : renderLogoMotion)(source, effect, config.accent, config.matte);
				if (motionKey === mKey) patch({ motion: keep(out, mKey) });
			}));
		} else if (!mKey && config.motion) {
			patch({ motion: null });
		}
		const sKey = scriptKey;
		if (sKey && config.scriptImage?.key !== sKey) {
			const { name, accent, matte, script } = config;
			jobs.push(run(async () => {
				const out = await renderHandwrittenName(name.trim(), script.font, accent, matte, script.loop);
				if (scriptKey === sKey) patch({ scriptImage: keep(out, sKey) });
			}));
		}
		const lKey = liveKey;
		if (lKey && config.liveImages.available?.key !== lKey) {
			const live = config.live;
			const matte = config.matte;
			jobs.push(run(async () => {
				const out = await renderLiveBadges(live, matte);
				if (liveKey === lKey) {
					patch({ liveImages: { available: keep(out.available, lKey), away: keep(out.away, lKey), ooo: keep(out.ooo, lKey) } });
				}
			}));
		}
		await Promise.all(jobs);
	}

	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// Re-run whenever any render input changes; wait for typing to settle.
		void [motionKey, scriptKey, liveKey];
		clearTimeout(renderTimer);
		renderTimer = setTimeout(() => void renderStale(), 450);
		return () => clearTimeout(renderTimer);
	});

	async function uploadBlob(blob: Blob): Promise<string> {
		const body = new FormData();
		body.set('file', new File([blob], 'signature.gif', { type: blob.type }));
		const res = await fetch('/api/signature-assets', { method: 'POST', body });
		const json = (await res.json()) as { error?: string; id?: string };
		if (!res.ok || !json.id) throw new Error(json.error ?? 'Could not upload the rendered effect');
		return json.id;
	}

	/**
	 * Finishes any render and uploads the results, swapping placeholder ids for
	 * stored ones. Call before saving; returns the value to store.
	 */
	export async function bake(): Promise<string> {
		clearTimeout(renderTimer);
		await renderStale();
		const swap = async (image: BakedImage | null): Promise<BakedImage | null> => {
			if (!image || !pending[image.id]) return image;
			return { ...image, id: await uploadBlob(pending[image.id].blob) };
		};
		const [motion, scriptImage, available, away, ooo] = await Promise.all([
			swap(config.motion),
			swap(config.scriptImage),
			swap(config.liveImages.available),
			swap(config.liveImages.away),
			swap(config.liveImages.ooo)
		]);
		patch({ motion, scriptImage, liveImages: { available, away, ooo } });
		return serializeSignatureConfig(config);
	}

	onDestroy(() => {
		clearTimeout(renderTimer);
		for (const entry of Object.values(pending)) URL.revokeObjectURL(entry.url);
	});

	$effect(() => {
		if (value !== lastValue) {
			config = parseSignatureConfig(value);
			lastValue = value;
		}
	});

	function commit(next: SignatureConfig) {
		config = next;
		// Unsaved renders live only in this editor; the stored value never points at them,
		// so a remount simply renders them again instead of showing broken images.
		const stored = serializeSignatureConfig(withoutPending(next));
		lastValue = stored;
		value = stored;
	}

	function withoutPending(next: SignatureConfig): SignatureConfig {
		const drop = (image: BakedImage | null) => (image && pending[image.id] ? null : image);
		return {
			...next,
			motion: drop(next.motion),
			scriptImage: drop(next.scriptImage),
			liveImages: { available: drop(next.liveImages.available), away: drop(next.liveImages.away), ooo: drop(next.liveImages.ooo) }
		};
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

	const animations: { id: SignatureAnimation; label: string; hint: string }[] = [
		{ id: 'none', label: 'Still', hint: 'No motion' },
		{ id: 'halo', label: 'Halo', hint: 'A ring of colour circles' },
		{ id: 'ripple', label: 'Ripple', hint: 'Rings pulse outward' },
		{ id: 'shine', label: 'Shine', hint: 'A glint sweeps across' },
		{ id: 'glow', label: 'Glow', hint: 'Breathes in your colour' },
		{ id: 'float', label: 'Float', hint: 'Bobs gently' },
		{ id: 'pulse', label: 'Pulse', hint: 'Swells softly' },
		{ id: 'wave', label: 'Wave', hint: 'Rocks side to side' },
		{ id: 'spin', label: 'Spin', hint: 'Turns slowly' }
	];

	const scriptFonts = Object.entries(SCRIPT_FONTS) as [SignatureScriptFont, (typeof SCRIPT_FONTS)[SignatureScriptFont]][];
	const weekdays = [
		{ day: 1, label: 'Mon' },
		{ day: 2, label: 'Tue' },
		{ day: 3, label: 'Wed' },
		{ day: 4, label: 'Thu' },
		{ day: 5, label: 'Fri' },
		{ day: 6, label: 'Sat' },
		{ day: 0, label: 'Sun' }
	];
	const timeZones: string[] = (() => {
		try {
			return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
		} catch {
			return ['UTC'];
		}
	})();

	function patchLive(partial: Partial<SignatureLive>) {
		patch({ live: { ...config.live, ...partial } });
	}

	function enableLive(on: boolean) {
		// Start from this browser's zone the first time.
		const tz = config.live.tz === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : config.live.tz;
		patchLive({ enabled: on, tz });
	}

	function toTime(minutes: number): string {
		return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	}

	function fromTime(value: string): number {
		const [h, m] = value.split(':').map(Number);
		return (h || 0) * 60 + (m || 0);
	}

	function toggleDay(day: number) {
		const days = config.live.days.includes(day) ? config.live.days.filter((d) => d !== day) : [...config.live.days, day];
		patchLive({ days });
	}

	$effect(() => {
		if (config.script.enabled) void loadSignatureFonts();
	});

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
		try {
			await onsave?.(await bake());
		} catch (cause) {
			renderError = cause instanceof Error ? cause.message : 'Could not save the signature';
		}
	}

	async function clearCustom() {
		commit(parseSignatureConfig(''));
		await onsave?.('');
	}
</script>

<div class="editor" class:compact>
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

			{#if (config.layout === 'photo' && config.photoId) || (config.layout === 'logo' && config.logoId)}
				<div class="animation">
					<div class="section-head">
						<span class="label" id="sig-effect-label">Effect</span>
						<span class="section-note">Baked into an animated image, so it plays in Gmail, Apple Mail and Outlook on the web.</span>
					</div>
					<div class="animation-grid" role="radiogroup" aria-labelledby="sig-effect-label">
						{#each animations as animation (animation.id)}
							<button
								type="button"
								role="radio"
								class="anim-card"
								class:selected={config.animation === animation.id}
								aria-checked={config.animation === animation.id}
								{disabled}
								onclick={() => patch({ animation: animation.id })}
							>
								<span class="anim-name">{animation.label}</span>
								{#if !compact}<span class="anim-hint">{animation.hint}</span>{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
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

		<div class="extras">
			<div class="extra">
				<div class="extra-head">
					<span class="extra-text">
						<span class="extra-title">Email background</span>
						<span class="section-note">Animated images are drawn on this colour. Pick what most of your readers use.</span>
					</span>
					<div class="segmented" role="radiogroup" aria-label="Email background">
						<button type="button" role="radio" aria-checked={config.matte === 'light'} {disabled} onclick={() => patch({ matte: 'light' })}>Light</button>
						<button type="button" role="radio" aria-checked={config.matte === 'dark'} {disabled} onclick={() => patch({ matte: 'dark' })}>Dark</button>
					</div>
				</div>
			</div>

			<div class="extra">
				<label class="extra-head">
					<span class="extra-text">
						<span class="extra-title">Handwritten name</span>
						<span class="section-note">Your name writes itself in ink when the email is opened.</span>
					</span>
					<input
						class="switch"
						type="checkbox"
						role="switch"
						checked={config.script.enabled}
						{disabled}
						onchange={(event) => patch({ script: { ...config.script, enabled: event.currentTarget.checked } })}
					/>
				</label>
				{#if config.script.enabled}
					{#if !config.name.trim()}<p class="section-note">Add your name above to see it written.</p>{/if}
					<div class="script-fonts" role="radiogroup" aria-label="Handwriting style">
						{#each scriptFonts as [id, font] (id)}
							<button
								type="button"
								role="radio"
								class="script-card"
								class:selected={config.script.font === id}
								aria-checked={config.script.font === id}
								aria-label={font.label}
								{disabled}
								onclick={() => patch({ script: { ...config.script, font: id } })}
							>
								<span style="font-family: '{font.family}', cursive; font-weight: {font.weight}; font-size: {Math.round(font.size * 0.62)}px; color: {config.accent};">{config.name.trim() || 'Your name'}</span>
							</button>
						{/each}
					</div>
					<div class="segmented" role="radiogroup" aria-label="Replay">
						<button type="button" role="radio" aria-checked={!config.script.loop} {disabled} onclick={() => patch({ script: { ...config.script, loop: false } })}>Write once</button>
						<button type="button" role="radio" aria-checked={config.script.loop} {disabled} onclick={() => patch({ script: { ...config.script, loop: true } })}>Replay</button>
					</div>
				{/if}
			</div>

			<div class="extra">
				<label class="extra-head">
					<span class="extra-text">
						<span class="extra-title">Live availability</span>
						<span class="section-note">A badge that changes when it is opened: available during your hours, away after, out of office on dates you set. Even weeks-old emails stay current.</span>
					</span>
					<input
						class="switch"
						type="checkbox"
						role="switch"
						checked={config.live.enabled}
						{disabled}
						onchange={(event) => enableLive(event.currentTarget.checked)}
					/>
				</label>
				{#if config.live.enabled}
					<div class="fields">
						<label class="field">
							<span>Time zone</span>
							<select class="text-input" value={config.live.tz} {disabled} onchange={(event) => patchLive({ tz: event.currentTarget.value })}>
								{#each timeZones as zone (zone)}<option value={zone}>{zone.replaceAll('_', ' ')}</option>{/each}
							</select>
						</label>
						<label class="field">
							<span>City (optional)</span>
							<input class="text-input" value={config.live.city} maxlength="40" placeholder="Toronto" {disabled} oninput={(event) => patchLive({ city: event.currentTarget.value })} />
						</label>
						<label class="field">
							<span>Hours start</span>
							<input class="text-input" type="time" step="900" value={toTime(config.live.start)} {disabled} onchange={(event) => patchLive({ start: fromTime(event.currentTarget.value) })} />
						</label>
						<label class="field">
							<span>Hours end</span>
							<input class="text-input" type="time" step="900" value={toTime(config.live.end)} {disabled} onchange={(event) => patchLive({ end: fromTime(event.currentTarget.value) })} />
						</label>
					</div>
					<div class="days" role="group" aria-label="Working days">
						{#each weekdays as item (item.day)}
							<button type="button" class="day" aria-pressed={config.live.days.includes(item.day)} {disabled} onclick={() => toggleDay(item.day)}>{item.label}</button>
						{/each}
					</div>
					<div class="fields">
						<label class="field">
							<span>Out of office from</span>
							<input class="text-input" type="date" value={config.live.oooFrom} {disabled} onchange={(event) => patchLive({ oooFrom: event.currentTarget.value })} />
						</label>
						<label class="field">
							<span>Back after</span>
							<input class="text-input" type="date" value={config.live.oooTo} min={config.live.oooFrom || undefined} {disabled} onchange={(event) => patchLive({ oooTo: event.currentTarget.value })} />
						</label>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="preview-block">
		<span class="label">Sent as {#if rendering}<span class="render-note" aria-live="polite">Rendering…</span>{/if}</span>
		{#if renderError}<p class="error" role="alert">{renderError}</p>{/if}
		<SignaturePreview html={compiled.html} dark={config.matte === 'dark'} empty="Nothing will be appended yet." />
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

	/* Wide screens: fields on the left, the live preview pinned on the right. */
	@media (min-width: 1180px) {
		.editor:not(.compact) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(17rem, 21rem);
			align-items: start;
			gap: 1.25rem 2rem;
		}

		.editor:not(.compact) > :global(*) {
			grid-column: 1;
		}

		.editor:not(.compact) > .preview-block {
			grid-column: 2;
			grid-row: 1 / span 12;
			position: sticky;
			top: 1rem;
		}
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
	.animation,
	.preview-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.animation-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
		gap: 0.4rem;
	}

	.anim-card {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.5rem 0.6rem;
		border-radius: 0.6rem;
		text-align: left;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.anim-name {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.anim-hint {
		font-size: 0.6875rem;
		line-height: 1.3;
		color: var(--color-muted);
	}

	.section-head {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.section-note {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-muted);
	}

	.extras {
		display: flex;
		flex-direction: column;
		border-radius: 0.85rem;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.extra {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem 0.95rem;
	}

	.extra + .extra {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.extra-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.extra-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.extra-title {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.segmented {
		display: inline-flex;
		flex-shrink: 0;
		align-self: flex-start;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 0.65rem;
		background: var(--color-well);
	}

	.extra-head .segmented {
		align-self: center;
	}

	.segmented button {
		height: 1.85rem;
		padding: 0 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.segmented button[aria-checked='true'] {
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: 500;
		box-shadow: var(--shadow-xs);
	}

	.script-fonts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.script-card {
		display: flex;
		align-items: center;
		min-height: 3.25rem;
		padding: 0.35rem 0.75rem;
		overflow: hidden;
		border-radius: 0.6rem;
		background: #ffffff;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.script-card.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.day {
		min-width: 2.75rem;
		height: 2rem;
		padding: 0 0.5rem;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.day[aria-pressed='true'] {
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
		box-shadow: none;
		font-weight: 600;
	}

	.render-note {
		margin-left: 0.4rem;
		color: var(--color-accent-text);
	}

	.anim-card:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.anim-card.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
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

		.animation-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>

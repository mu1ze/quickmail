<script lang="ts">
	import Icon from './Icon.svelte';
	import PdfPreview from './PdfPreview.svelte';
	import { attachmentHref, attachmentPreviewKind } from '$lib/utils/attachments';
	import { formatFileSize } from '$lib/utils/html';
	import type { EmailAttachmentMeta } from '$lib/types';

	let { emailId, files, index = $bindable(0), onClose }: {
		emailId: string; files: EmailAttachmentMeta[]; index?: number; onClose: () => void;
	} = $props();
	let dialog = $state<HTMLDialogElement | null>(null);
	let text = $state('');
	let loading = $state(true);
	let error = $state('');
	let zoom = $state(1);
	let imageWidth = $state(0);
	let imageHeight = $state(0);
	let areaWidth = $state(0);
	let areaHeight = $state(0);
	const fit = $derived(Math.max(0.01, Math.min(1, (areaWidth - 32) / (imageWidth || 1), (areaHeight - 32) / (imageHeight || 1))));
	const file = $derived(files[index]);
	const kind = $derived(attachmentPreviewKind(file?.content_type ?? ''));
	const source = $derived(file ? attachmentHref(emailId, file.id) : '');

	$effect(() => { dialog?.showModal(); });
	$effect(() => {
		const href = source;
		const controller = new AbortController();
		loading = true;
		error = '';
		text = '';
		zoom = 1;
		imageWidth = 0;
		imageHeight = 0;
		if (kind === 'text') {
			// Source files are displayed as text, never interpreted as page HTML.
			void fetch(href, { signal: controller.signal, headers: { Range: 'bytes=0-262143' } })
				.then(async (response) => {
					if (!response.ok) throw new Error('This attachment could not be loaded. Try downloading it.');
					const value = await response.text();
					if (!controller.signal.aborted) { text = value; loading = false; }
				})
				.catch((cause) => {
					if (!controller.signal.aborted) { error = cause.message; loading = false; }
				});
		} else if (!kind || kind === 'audio' || kind === 'pdf') loading = false;
		return () => controller.abort();
	});
	function move(delta: number) { index = (index + delta + files.length) % files.length; }
	function onKeydown(event: KeyboardEvent) {
		if (event.target instanceof HTMLMediaElement) return;
		if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
		if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
	}
	function failed() { loading = false; error = 'Preview unavailable. You can still download this file.'; }
	function imageLoaded(event: Event) {
		const image = event.currentTarget as HTMLImageElement;
		imageWidth = image.naturalWidth;
		imageHeight = image.naturalHeight;
		loading = false;
	}
</script>

<dialog bind:this={dialog} class="preview-dialog" data-overlay aria-labelledby="attachment-preview-title"
	onclose={onClose} onkeydown={onKeydown}
	onclick={(event) => { if (event.target === dialog) onClose(); }}>
	{#if file}
		<section class="preview-panel">
			<header>
				<div class="heading">
					<h2 id="attachment-preview-title" title={file.filename}>{file.filename}</h2>
					<p>{formatFileSize(file.size_bytes)} · {index + 1} of {files.length}</p>
				</div>
				<a class="preview-button" href={attachmentHref(emailId, file.id, true)} download={file.filename}>
					<Icon name="download-2-line" size={18} /><span>Download</span>
				</a>
				<button type="button" class="preview-button" aria-label="Close preview" onclick={onClose}>
					<Icon name="close-line" size={22} />
				</button>
			</header>
			<div class="preview-content" class:preview-image={kind === 'image'} aria-busy={loading} bind:clientWidth={areaWidth} bind:clientHeight={areaHeight}>
				{#if loading}<p class="preview-status" role="status">Loading preview…</p>{/if}
				{#if error}<p class="preview-status" role="alert">{error}</p>{/if}
				{#key source}
					{#if kind === 'image'}
						<div class="image-stage" style:width={`${Math.max(areaWidth, imageWidth * fit * zoom + 32)}px`} style:height={`${Math.max(areaHeight, imageHeight * fit * zoom + 32)}px`}>
							<img src={source} alt={file.filename} onload={imageLoaded} onerror={failed}
								style:width={imageWidth ? `${imageWidth * fit * zoom}px` : undefined}
								style:height={imageHeight ? `${imageHeight * fit * zoom}px` : undefined} />
						</div>
					{:else if kind === 'video'}
						<video src={source} controls playsinline preload="metadata" onloadedmetadata={() => (loading = false)} onerror={failed}>
							<track kind="captions" />
						</video>
					{:else if kind === 'audio'}
						<div class="audio-preview"><Icon name="music-2-line" size={56} />
							<audio src={source} controls preload="metadata" onerror={failed}></audio>
						</div>
					{:else if kind === 'pdf'}
						<PdfPreview {source} filename={file.filename} />
					{:else if kind === 'text'}
						<pre>{text}</pre>
					{:else}
						<p class="preview-status">A preview is unavailable for this file type. Download it to open it.</p>
					{/if}
				{/key}
			</div>
			<footer>
				<button type="button" class="preview-button" disabled={files.length < 2} onclick={() => move(-1)} aria-label="Previous attachment">
					<Icon name="arrow-left-s-line" size={20} /> Previous
				</button>
				{#if kind === 'image'}
					<div class="zoom-controls">
						<button type="button" class="preview-button" aria-label="Zoom out" disabled={zoom <= 1} onclick={() => (zoom = Math.max(1, zoom - 0.5))}><Icon name="subtract-line" size={16} /></button>
						<button type="button" class="preview-button" aria-label="Fit image" onclick={() => (zoom = 1)}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
						<button type="button" class="preview-button" aria-label="Zoom in" disabled={zoom >= 4} onclick={() => (zoom = Math.min(4, zoom + 0.5))}><Icon name="add-line" size={16} /></button>
					</div>
				{:else}<span>{kind === 'text' && file.size_bytes > 262144 ? 'Showing the first 256 KB' : 'Use ← → to browse · Esc to close'}</span>{/if}
				<button type="button" class="preview-button" disabled={files.length < 2} onclick={() => move(1)} aria-label="Next attachment">
					Next <Icon name="arrow-right-s-line" size={20} />
				</button>
			</footer>
		</section>
	{/if}
</dialog>

<style>
	.preview-dialog { width: min(960px, calc(100vw - 2rem)); max-width: none; max-height: calc(100dvh - 2rem); margin: auto; padding: 0; border: 1px solid var(--color-line); border-radius: 1rem; background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-lg); }
	.preview-dialog::backdrop { background: rgb(0 0 0 / 65%); backdrop-filter: blur(6px); }
	.preview-panel { display: flex; flex-direction: column; }
	header, footer { display: flex; align-items: center; gap: 0.75rem; padding: 1rem; }
	header { border-bottom: 1px solid var(--color-line); }
	.heading { min-width: 0; flex: 1; }
	h2 { font-size: 0.95rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	p, footer span { font-size: 0.75rem; color: var(--color-text-secondary); }
	.preview-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; padding: 0.5rem; border-radius: 0.5rem; font-size: 0.8125rem; white-space: nowrap; }
	.preview-button:hover { background: var(--color-surface-hover); }
	.preview-button:disabled { opacity: 0.4; cursor: default; }
	.preview-content { position: relative; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 18rem; height: min(65dvh, 680px); overflow: auto; background: var(--color-surface-muted); }
	.preview-content img, video { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
	.preview-status { position: absolute; inset: 0; z-index: 1; display: grid; align-content: center; padding: 1rem; text-align: center; background: var(--color-surface-muted); pointer-events: none; }
	pre { align-self: stretch; margin: 0; padding: 1.5rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.8125rem; }
	.audio-preview { display: grid; justify-items: center; gap: 2rem; padding: 1rem; width: 100%; }
	audio { width: min(100%, 28rem); }
	footer { justify-content: space-between; border-top: 1px solid var(--color-line); }
	.zoom-controls { display: flex; gap: 0.25rem; }
	.preview-content.preview-image { display: block; }
	.image-stage { display: grid; place-items: center; padding: 1rem; }
	.image-stage img { max-width: none; max-height: none; }
	@media (max-width: 600px) { .preview-dialog { width: calc(100vw - 1rem); } header { gap: 0.25rem; padding: 0.75rem; } header a span, footer span { display: none; } footer { padding: 0.5rem; } }
</style>

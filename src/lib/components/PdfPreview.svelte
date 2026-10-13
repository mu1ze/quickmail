<script lang="ts">
	import Icon from './Icon.svelte';
	import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
	import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { requireOk, requestError } from '$lib/utils/request';

	let { source, filename }: { source: string; filename: string } = $props();
	let pdf = $state.raw<PDFDocumentProxy | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	let pageNumber = $state(1);
	let zoom = $state(1);
	let busy = $state(true);
	let error = $state('');
	let pageText = $state('');
	let canvasWidth = $state(0);
	let canvasHeight = $state(0);
	let rendering: RenderTask | null = null;

	$effect(() => {
		const href = source;
		const controller = new AbortController();
		let task: PDFDocumentLoadingTask | null = null;
		busy = true;
		error = '';
		pdf = null;
		pageNumber = 1;
		void (async () => {
			try {
				const [renderer, response] = await Promise.all([
					import('pdfjs-dist'), fetch(href, { signal: controller.signal })
				]);
				await requireOk(response);
				renderer.GlobalWorkerOptions.workerSrc = workerUrl;
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (controller.signal.aborted) return;
				task = renderer.getDocument({ data: bytes, useSystemFonts: true, enableXfa: false });
				const document = await task.promise;
				if (!controller.signal.aborted) pdf = document;
			} catch (cause) {
				if (!controller.signal.aborted) { busy = false; error = `Could not preview this PDF. ${requestError(cause)}`; }
			}
		})();
		return () => { controller.abort(); rendering?.cancel(); void task?.destroy(); };
	});

	$effect(() => {
		const document = pdf;
		const target = canvas;
		const page = pageNumber;
		const areaWidth = width;
		const magnification = zoom;
		if (!document || !target || !areaWidth) return;
		let cancelled = false;
		const previous = rendering;
		previous?.cancel();
		busy = true;
		error = '';
		void (async () => {
			try {
				await previous?.promise.catch(() => {});
				const content = await document.getPage(page);
				if (cancelled) return;
				const native = content.getViewport({ scale: 1 });
				const scale = Math.max(0.1, Math.min((areaWidth - 32) / native.width, 1.5) * magnification);
				const viewport = content.getViewport({ scale });
				const resolution = Math.min(window.devicePixelRatio || 1, 2);
				canvasWidth = viewport.width;
				canvasHeight = viewport.height;
				target.width = Math.ceil(viewport.width * resolution);
				target.height = Math.ceil(viewport.height * resolution);
				const context = target.getContext('2d');
				if (!context) throw new Error('PDF drawing is unavailable in this browser.');
				rendering = content.render({ canvas: target, canvasContext: context, viewport,
					transform: resolution === 1 ? undefined : [resolution, 0, 0, resolution, 0, 0] });
				await rendering.promise;
				if (cancelled) return;
				const text = await content.getTextContent();
				pageText = text.items.map((item) => 'str' in item ? item.str : '').join(' ');
				busy = false;
			} catch (cause) {
				if (!cancelled) { busy = false; error = `Could not render this page. ${requestError(cause)}`; }
			}
		})();
		return () => { cancelled = true; rendering?.cancel(); };
	});
</script>

<div class="pdf-preview" bind:clientWidth={width} aria-busy={busy}>
	{#if pdf}
		<nav aria-label="PDF pages" class="pdf-toolbar">
			<button type="button" disabled={pageNumber <= 1} aria-label="Previous PDF page" onclick={() => (pageNumber -= 1)}><Icon name="arrow-left-s-line" size={18} /></button>
			<span>Page {pageNumber} of {pdf.numPages}</span>
			<button type="button" disabled={pageNumber >= pdf.numPages} aria-label="Next PDF page" onclick={() => (pageNumber += 1)}><Icon name="arrow-right-s-line" size={18} /></button>
			<button type="button" disabled={zoom <= 0.5} aria-label="Zoom PDF out" onclick={() => (zoom = Math.max(0.5, zoom - 0.25))}><Icon name="subtract-line" size={16} /></button>
			<button type="button" aria-label="Fit PDF page" onclick={() => (zoom = 1)}>Fit</button>
			<button type="button" disabled={zoom >= 2} aria-label="Zoom PDF in" onclick={() => (zoom = Math.min(2, zoom + 0.25))}><Icon name="add-line" size={16} /></button>
		</nav>
	{/if}
	<div class="pdf-page">
		<canvas bind:this={canvas} style:width={canvasWidth ? `${canvasWidth}px` : undefined}
			style:height={canvasHeight ? `${canvasHeight}px` : undefined} aria-label={`${filename}, page ${pageNumber}`}></canvas>
		<span class="sr-only">{pageText}</span>
	</div>
	{#if busy}<p class="pdf-status" role="status">Loading PDF preview…</p>{/if}
	{#if error}<p class="pdf-status" role="alert">{error} You can download the original file.</p>{/if}
</div>

<style>
	.pdf-preview { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; min-height: 0; }
	.pdf-toolbar { display: flex; align-items: center; justify-content: center; gap: 0.375rem; padding: 0.375rem; background: var(--color-surface); border-bottom: 1px solid var(--color-line); font-size: 0.75rem; }
	.pdf-toolbar button { display: inline-flex; align-items: center; justify-content: center; min-width: 2rem; height: 2rem; border-radius: 0.375rem; }
	.pdf-toolbar button:hover { background: var(--color-surface-hover); }
	.pdf-toolbar button:disabled { opacity: 0.4; }
	.pdf-page { flex: 1; overflow: auto; padding: 1rem; text-align: center; }
	canvas { display: inline-block; background: #fff; box-shadow: var(--shadow-sm); vertical-align: top; }
	.pdf-status { position: absolute; inset: 3rem 0 0; display: grid; align-content: center; text-align: center; padding: 1.5rem; font-size: 0.8125rem; color: var(--color-text-secondary); background: var(--color-surface-muted); pointer-events: none; }
</style>

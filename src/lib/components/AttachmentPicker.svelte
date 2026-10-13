<script lang="ts">
	import Icon from './Icon.svelte';
	import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '$lib/constants';
	import { attachmentByteLength, fileContentType } from '$lib/utils/attachment-input';
	import { attachmentIcon, isImageType } from '$lib/utils/attachments';
	import { formatFileSize } from '$lib/utils/html';
	import type { OutboundAttachmentInput } from '$lib/types';

	let { attachments = $bindable([]), busy = $bindable(false), disabled = false }: {
		attachments?: OutboundAttachmentInput[]; busy?: boolean; disabled?: boolean;
	} = $props();
	let input = $state<HTMLInputElement | null>(null);
	let error = $state('');
	let dragging = $state(false);

	export async function addFiles(files: FileList | File[] | null) {
		if (!files?.length || busy || disabled) return;
		busy = true;
		error = '';
		const errors: string[] = [];
		try {
			for (const file of Array.from(files)) {
				if (attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) {
					errors.push(`You can attach up to ${MAX_ATTACHMENTS_PER_EMAIL} files.`); break;
				}
				if (file.size > MAX_ATTACHMENT_BYTES) {
					errors.push(`“${file.name}” exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`); continue;
				}
				try {
					const content = await fileToBase64(file);
					attachments = [...attachments, { filename: file.name, type: fileContentType(file), content }];
				} catch { errors.push(`Could not read “${file.name}”. Please try again.`); }
			}
		} finally {
			busy = false;
			error = errors.join(' ');
			if (input) input.value = '';
		}
	}
	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
			reader.onerror = () => reject(new Error('Could not read file'));
			reader.onabort = () => reject(new Error('Reading cancelled'));
			reader.readAsDataURL(file);
		});
	}
</script>

<div class="picker" class:dragging role="group" aria-label="Message attachments"
	ondragover={(event) => { event.preventDefault(); if (!disabled) dragging = true; }}
	ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dragging = false; }}
	ondrop={(event) => { event.preventDefault(); dragging = false; void addFiles(event.dataTransfer?.files ?? null); }}>
	<div class="picker-toolbar">
		<button type="button" class="attach-btn" disabled={busy || disabled || attachments.length >= MAX_ATTACHMENTS_PER_EMAIL} onclick={() => input?.click()}>
			<Icon name="attachment-2" size={16} /><span>{busy ? 'Adding files…' : 'Attach files'}</span>
		</button>
		<span class="hint">Drop files here · Up to {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each</span>
	</div>
	<input bind:this={input} type="file" multiple class="hidden" aria-label="Choose attachments" onchange={(event) => addFiles(event.currentTarget.files)} />
	{#if attachments.length}
		<div class="picked-files">
			{#each attachments as file, index (file.filename + index)}
				<div class="attachment-chip">
					{#if isImageType(file.type)}
						<img src={`data:${file.type};base64,${file.content}`} alt="" />
					{:else}<span class="chip-icon"><Icon name={attachmentIcon(file.type)} size={22} /></span>{/if}
					<span class="chip-info"><span class="filename" title={file.filename}>{file.filename}</span>
						<span class="size">{formatFileSize(attachmentByteLength(file.content))}</span>
					</span>
					<button type="button" class="chip-remove" disabled={disabled || busy} aria-label={`Remove ${file.filename}`}
						onclick={() => (attachments = attachments.filter((_, i) => i !== index))}><Icon name="close-line" size={16} /></button>
				</div>
			{/each}
		</div>
	{/if}
	{#if error}<p class="picker-error" role="alert">{error}</p>{/if}
	<span class="sr-only" role="status">{busy ? 'Reading attachments' : `${attachments.length} files attached`}</span>
</div>

<style>
	.picker { border: 1px dashed transparent; border-radius: 0.75rem; padding: 0.25rem; transition: border-color 0.15s, background 0.15s; }
	.picker.dragging { border-color: var(--color-accent); background: var(--color-surface-hover); }
	.picker-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 0.75rem; }
	.attach-btn { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 0.75rem; border-radius: 0.5rem; font-size: 0.8125rem; color: var(--color-text-secondary); background: var(--color-surface-muted); }
	.attach-btn:hover { background: var(--color-surface-hover); }
	.attach-btn:disabled, .chip-remove:disabled { opacity: 0.5; }
	.hint, .size { font-size: 0.75rem; color: var(--color-muted); }
	.picked-files { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
	.attachment-chip { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-radius: 0.625rem; background: var(--color-surface-muted); }
	.attachment-chip img, .chip-icon { width: 2.5rem; height: 2.5rem; border-radius: 0.375rem; object-fit: cover; }
	.chip-icon { display: grid; place-items: center; color: var(--color-muted); }
	.chip-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; }
	.chip-remove { padding: 0.375rem; border-radius: 0.375rem; color: var(--color-muted); }
	.chip-remove:hover { background: var(--color-surface-hover); color: var(--color-text); }
	.picker-error { margin-top: 0.5rem; font-size: 0.8125rem; color: var(--color-danger); }
</style>

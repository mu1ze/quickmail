<script lang="ts">
	import { untrack } from 'svelte';
	import { seedEditor } from '$lib/editor-seed';
	import Icon from './Icon.svelte';
	import DOMPurify from 'dompurify';
	import { isImageType } from '$lib/utils/attachments';
	import type { OutboundAttachmentInput } from '$lib/types';

	let {
		html = $bindable(''),
		placeholder = 'Write your message…',
		minHeight = 240,
		embedded = false,
		showToolbar = true,
		disabled = false,
		onFiles,
		attachments = []
	}: {
		html?: string;
		placeholder?: string;
		minHeight?: number;
		embedded?: boolean;
		showToolbar?: boolean;
		disabled?: boolean;
		onFiles?: (files: File[]) => void;
		attachments?: OutboundAttachmentInput[];
	} = $props();

	let editor = $state<HTMLDivElement | null>(null);
	let seeded = $state(false);

	// Seed once when the contenteditable node mounts. Gating on a truthy `html`
	// left empty composers unseeded, so the first keystroke wrote innerHTML and
	// jumped the caret to the start.
	$effect(() => {
		seeded = seedEditor(editor, DOMPurify.sanitize(untrack(() => html), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'] }), seeded);
	});
	$effect(() => {
		if (!editor || !seeded) return;
		const urls: string[] = [];
		const images = editor.querySelectorAll<HTMLImageElement>('img[src^="cid:"], img[data-inline-cid]');
		for (const image of images) {
			const cid = image.dataset.inlineCid ?? image.getAttribute('src')?.slice(4) ?? '';
			const file = attachments.find((file) => file.contentId === cid && isImageType(file.type));
			if (!file) { image.removeAttribute('src'); continue; }
			const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
			const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
			urls.push(url);
			image.dataset.inlineCid = cid;
			image.src = url;
		}
		return () => urls.forEach((url) => URL.revokeObjectURL(url));
	});

	function exec(command: string, value?: string) {
		editor?.focus();
		document.execCommand(command, false, value);
		handleInput();
	}

	function handleInput() {
		const copy = editor?.cloneNode(true) as HTMLDivElement | undefined;
		for (const image of copy?.querySelectorAll<HTMLImageElement>('img[data-inline-cid]') ?? []) {
			image.setAttribute('src', `cid:${image.dataset.inlineCid}`);
			delete image.dataset.inlineCid;
		}
		html = copy?.innerHTML ?? '';
	}

	function handlePaste(event: ClipboardEvent) {
		if (disabled) return;
		event.preventDefault();
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length && onFiles) { onFiles(files); return; }
		const markup = event.clipboardData?.getData('text/html');
		if (markup) {
			const clean = DOMPurify.sanitize(markup, {
				ALLOWED_TAGS: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote', 'pre', 'code'],
				ALLOWED_ATTR: ['href']
			});
			document.execCommand('insertHTML', false, clean);
			handleInput();
			return;
		}
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
		handleInput();
	}

	const tools = [
		{ icon: 'bold', command: 'bold', label: 'Bold' },
		{ icon: 'italic', command: 'italic', label: 'Italic' },
		{ icon: 'underline', command: 'underline', label: 'Underline' },
		{ icon: 'list-unordered', command: 'insertUnorderedList', label: 'List' },
		{ icon: 'link', command: 'createLink', label: 'Link', prompt: true }
	] as const;

	function handleTool(tool: (typeof tools)[number]) {
		if ('prompt' in tool && tool.prompt) {
			const url = window.prompt('Link URL');
			if (url && /^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) exec('createLink', url.trim());
			return;
		}
		exec(tool.command);
	}
</script>

<div class="editor-shell" class:editor-shell-embedded={embedded} data-ready={seeded}>
	{#if showToolbar}
		<div class="toolbar">
			{#each tools as tool (tool.command)}
				<button
					type="button"
					class="icon-btn"
					title={tool.label}
					aria-label={tool.label}
					{disabled}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => handleTool(tool)}
				>
					<Icon name={tool.icon} size={16} />
				</button>
			{/each}
		</div>
	{/if}

	<div
		bind:this={editor}
		contenteditable={!disabled}
		role="textbox"
		tabindex={disabled ? -1 : 0}
		aria-label="Message body"
		aria-multiline="true"
		class="editor prose prose-sm max-w-none px-4 py-3 outline-none"
		style="min-height: {minHeight}px"
		data-placeholder={placeholder}
		oninput={handleInput}
		onpaste={handlePaste}
		ondragover={(event) => { if (onFiles) event.preventDefault(); }}
		ondrop={(event) => { if (onFiles && event.dataTransfer?.files.length) { event.preventDefault(); if (!disabled) onFiles(Array.from(event.dataTransfer.files)); } }}
	></div>
</div>

<style>
	.editor-shell {
		overflow: hidden;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
	}

	.editor-shell-embedded {
		border-radius: 0;
		box-shadow: none;
		background: transparent;
	}

	.editor-shell-embedded .toolbar {
		padding-left: 0;
		padding-right: 0;
	}

	.editor-shell-embedded .editor {
		padding-left: 0;
		padding-right: 0;
		padding-top: 0.75rem;
		min-height: 12rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 0.5rem;
	}

	.editor {
		color: var(--color-text);
	}

	.editor:empty::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		pointer-events: none;
	}

	.editor :global(p) {
		margin: 0 0 0.75em;
	}

	.editor :global(p:last-child) {
		margin-bottom: 0;
	}

	/* Tailwind's reset drops list markers, so a bulleted list typed here would
	   otherwise look like plain paragraphs. */
	.editor :global(ul) {
		list-style: disc outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(ol) {
		list-style: decimal outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(li) {
		margin: 0.15em 0;
	}

	.editor :global(a) {
		color: var(--color-accent-text);
		text-decoration: underline;
	}
	.editor :global(img) { max-width: 100%; height: auto; border-radius: 0.5rem; }
</style>

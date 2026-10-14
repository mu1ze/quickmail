<script lang="ts">
	import {
		buildEmailDocument,
		emailCss,
		hasRemoteContent,
		isRichHtml
	} from '$lib/utils/email-html';
	import { foldQuotedHtml } from '$lib/utils/quotes';
	import { prepareEmailHtml } from '$lib/utils/email-content';
	import type { EmailAttachmentMeta } from '$lib/types';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import {
		readRemoteContentPreference,
		shouldLoadRemoteContent,
		watchRemoteContentPreference
	} from '$lib/remote-content';

	const STYLE_ID = '__mail-frame-style';

	let { html, emailId = '', attachments = [] }: { html: string; emailId?: string; attachments?: EmailAttachmentMeta[] } = $props();

	const rich = $derived(isRichHtml(html));
	const remote = $derived(hasRemoteContent(html));
	let preference = $state(browser ? readRemoteContentPreference() : false);
	let messageOptIn = $state(false);
	const allowRemote = $derived(shouldLoadRemoteContent(preference, messageOptIn));
	const srcdoc = $derived(browser ? buildEmailDocument(prepareEmailHtml(html, emailId, attachments), {
		rich, allowRemote,
		localResourceBase: `${window.location.origin}/api/mail/${encodeURIComponent(emailId)}/attachments/`
	}) : '');

	$effect(() => {
		preference = readRemoteContentPreference();
		return watchRemoteContentPreference((enabled) => {
			preference = enabled;
		});
	});

	let frame = $state<HTMLIFrameElement | null>(null);
	let height = $state(240);

	let content: ResizeObserver | null = null;
	let theme: MutationObserver | null = null;
	let preparedDocument: Document | null = null;

	/**
	 * The frame has no scrollbar of its own; it is sized to its content. Measured
	 * on <body>, never on <html>: the root element's scrollHeight is floored at
	 * the viewport, which here is the height we just set — so it could only ever
	 * grow, never settle back down.
	 */
	function measure() {
		const doc = frame?.contentDocument;
		if (!doc?.body) return;

		const body = Math.max(doc.body.scrollHeight, doc.body.offsetHeight, doc.body.getBoundingClientRect().height);
		const next = Math.ceil(body || doc.documentElement.scrollHeight);
		if (next > 0 && Math.abs(next - height) > 1) height = next;
	}

	function syncTheme() {
		const doc = frame?.contentDocument;
		if (!doc) return;
		doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
	}

	/**
	 * The frame is same-origin but scriptless — `sandbox` withholds
	 * allow-scripts — so everything the message needs is done from out here.
	 */
	/** Messages that arrived as a whole document get our rules appended. */
	function applyStyles(doc: Document) {
		if (doc.getElementById(STYLE_ID)) return;

		const style = doc.createElement('style');
		style.id = STYLE_ID;
		style.textContent = emailCss(rich);
		(doc.head ?? doc.documentElement).appendChild(style);

		// Without a <base> of ours, a link would try to navigate this frame — which
		// the sandbox blocks, so the click would simply do nothing.
		for (const link of Array.from(doc.links)) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noopener noreferrer');
		}
	}

	function onLoad() {
		const doc = frame?.contentDocument;
		if (!doc?.body || doc.URL !== 'about:srcdoc') return;
		if (preparedDocument === doc) { measure(); return; }
		preparedDocument = doc;

		applyStyles(doc);
		syncTheme();
		foldQuotedHtml(doc.body);
		measure();

		// Images settle after load and change the height with them.
		for (const image of Array.from(doc.images)) {
			if (image.complete) continue;
			image.addEventListener('load', measure, { once: true });
			image.addEventListener('error', measure, { once: true });
		}

		content?.disconnect();
		content = new ResizeObserver(measure);
		content.observe(doc.body);

		theme?.disconnect();
		theme = new MutationObserver(syncTheme);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		// Recheck after the browser has painted the document, including cached
		// images and fonts that can settle before their load handlers are attached.
		requestAnimationFrame(measure);
		void doc.fonts?.ready.then(() => { if (frame?.contentDocument === doc) measure(); });
	}

	/**
	 * A srcdoc frame can finish loading before this component hydrates, in which
	 * case its load event is already gone and nothing would ever size it. The
	 * timer is the backstop: a message that resists measurement is shown at a
	 * readable height and left to scroll rather than hidden.
	 */
	$effect(() => {
		const source = srcdoc;
		const target = frame;
		if (!source || !target) return;
		untrack(() => {
			content?.disconnect();
			theme?.disconnect();
			preparedDocument = null;
		});
		// A remote image can delay iframe load indefinitely. Measure as soon as
		// the document is parsed instead of waiting for every remote request.
		const poll = setInterval(() => {
			const doc = target.contentDocument;
			if (doc?.URL === 'about:srcdoc' && doc.readyState !== 'loading' && doc.body) onLoad();
		}, 80);
		const timer = setTimeout(() => {
			clearInterval(poll);
			onLoad();
			measure();
			if (!preparedDocument && target.contentDocument) {
				target.contentDocument.documentElement.style.overflowY = 'auto';
			}
		}, 2000);
		return () => { clearInterval(poll); clearTimeout(timer); };
	});

	$effect(() => () => {
		content?.disconnect();
		theme?.disconnect();
	});
</script>

{#if remote && !allowRemote}
	<div class="remote-notice">
		<span>Remote images are blocked to protect your privacy.</span>
		<button type="button" onclick={() => (messageOptIn = true)}>Load remote content</button>
	</div>
{/if}

<iframe
	bind:this={frame}
	class="frame"
	class:rich
	title="Message content"
	sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
	referrerpolicy="no-referrer"
	{srcdoc}
	onload={onLoad}
	style:height={`${height}px`}
></iframe>

<style>
	.remote-notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: 0.6rem;
		color: var(--color-text-secondary);
		font-size: 0.8rem;
	}

	.remote-notice button {
		flex: none;
		border: 0;
		background: transparent;
		color: var(--color-accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.frame {
		display: block;
		width: 100%;
		min-height: 48px;
		border: 0;
		background: transparent;
	}
	.frame.rich { background: #fff; border-radius: 0.5rem; }
	@media (max-width: 600px) { .remote-notice { align-items: flex-start; flex-direction: column; } }
</style>

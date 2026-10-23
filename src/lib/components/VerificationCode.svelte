<script lang="ts">
	import Icon from './Icon.svelte';
	import { formatVerificationCode } from '$lib/verification-code';

	let { code, variant = 'chip', onTrash, busy = false, cleanupAt }: {
		code: string; variant?: 'chip' | 'card'; onTrash?: () => void; busy?: boolean; cleanupAt?: string | null;
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(event: Event) {
		// The chip sits inside the row's link: copy without opening the mail.
		event.preventDefault();
		event.stopPropagation();
		if (!(await writeClipboard(code))) return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1600);
	}

	async function writeClipboard(value: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(value);
			return true;
		} catch {
			// Older WebViews: copy through a hidden field.
			const field = document.createElement('textarea');
			field.value = value;
			field.setAttribute('readonly', '');
			field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
			document.body.append(field);
			field.select();
			const ok = document.execCommand('copy');
			field.remove();
			return ok;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') void copy(event);
	}
</script>

{#if variant === 'chip'}
	<!-- A span, not a button: the row is a link and buttons cannot nest in links. -->
	<span
		class="chip"
		class:copied
		role="button"
		tabindex="0"
		title="Copy code"
		aria-label={copied ? 'Code copied' : `Copy code ${code}`}
		onclick={copy}
		onkeydown={onKey}
		onpointerdown={(event) => event.stopPropagation()}
	>
		<Icon name={copied ? 'check-line' : 'key-2-line'} size={12} />
		<span class="value">{formatVerificationCode(code)}</span>
	</span>
{:else}
	<div class="card">
		<div class="label">
			<Icon name="key-2-line" size={14} />
			Verification code
		</div>
		<div class="row">
			<span class="big">{formatVerificationCode(code)}</span>
			<button type="button" class="copy" class:copied onclick={copy}>
				<Icon name={copied ? 'check-line' : 'file-copy-line'} size={15} />
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
		<div class="cleanup-actions">
			{#if onTrash}<button type="button" class="trash-code" disabled={busy} onclick={onTrash}><Icon name="delete-bin-line" size={15} />Trash this email</button>{/if}
			<a href="/settings/automations#code-cleanup">Code cleanup settings<Icon name="arrow-right-line" size={13} /></a>
		</div>
		{#if cleanupAt}<p class="cleanup-note">Scheduled for Trash five minutes after arrival. Star or pin this email to keep it.</p>{/if}
	</div>
{/if}

<style>
	.cleanup-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem 1rem; margin-top: 0.5rem; }
	.cleanup-actions button, .cleanup-actions a { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2.75rem; font-size: 0.75rem; }
	.cleanup-actions button { color: var(--color-text); }
	.cleanup-actions a { color: var(--color-accent-text); }
	.cleanup-actions button:hover, .cleanup-actions a:hover { text-decoration: underline; }
	.cleanup-note { margin-top: 0.25rem; color: var(--color-text-secondary); font-size: 0.75rem; line-height: 1.5; }
	.chip {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		margin: -0.125rem 0.45rem 0 0;
		gap: 0.3rem;
		flex-shrink: 0;
		height: 1.375rem;
		padding: 0 0.5rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: copy;
		transition: background 0.15s, transform 0.15s;
	}

	.chip:hover {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
	}

	.chip:active {
		transform: scale(0.96);
	}

	.chip:focus-visible {
		outline: 2px solid var(--color-focus-line);
		outline-offset: 1px;
	}

	.value,
	.big {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.card {
		margin: 1rem 0 0;
		padding: 0.875rem 1rem;
		border-radius: 12px;
		background: var(--color-accent-soft);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	.label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.35rem;
	}

	.big {
		font-size: 1.75rem;
		font-weight: 600;
		color: var(--color-text);
		user-select: all;
	}

	.copy {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.75rem;
		padding: 0 0.85rem;
		border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.8125rem;
		font-weight: 500;
		box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--color-line);
	}

	.copy.copied {
		color: var(--color-accent);
	}
</style>

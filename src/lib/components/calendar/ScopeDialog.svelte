<script lang="ts">
	import type { EditScope } from '$lib/calendar/types';

	let dialog = $state<HTMLDialogElement>();
	let heading = $state('');
	let allowThis = $state(true);
	let choice = $state<EditScope>('this');
	let resolver: ((scope: EditScope | null) => void) | null = null;

	/** Asks which occurrences of a repeating event a change applies to. */
	export function ask(options: { action: 'edit' | 'delete'; allowThis?: boolean }): Promise<EditScope | null> {
		heading = options.action === 'delete' ? 'Delete repeating event' : 'Change repeating event';
		allowThis = options.allowThis ?? true;
		choice = allowThis ? 'this' : 'following';
		dialog?.showModal();
		return new Promise((resolve) => (resolver = resolve));
	}

	function finish(scope: EditScope | null) {
		dialog?.close();
		resolver?.(scope);
		resolver = null;
	}
</script>

<dialog bind:this={dialog} class="scope" aria-label={heading} oncancel={(event) => { event.preventDefault(); finish(null); }}>
	<form onsubmit={(event) => { event.preventDefault(); finish(choice); }}>
		<h2>{heading}</h2>
		<div class="options" role="radiogroup">
			{#if allowThis}<label><input type="radio" name="scope" value="this" bind:group={choice} /> This event</label>{/if}
			<label><input type="radio" name="scope" value="following" bind:group={choice} /> This and following events</label>
			<label><input type="radio" name="scope" value="all" bind:group={choice} /> All events</label>
		</div>
		<footer>
			<button type="button" class="btn-ghost" onclick={() => finish(null)}>Cancel</button>
			<button type="submit" class="btn-primary">OK</button>
		</footer>
	</form>
</dialog>

<style>
	.scope { width: min(22rem, calc(100vw - 2rem)); margin: auto; padding: 1.25rem; border: 1px solid var(--color-line); border-radius: 18px; background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-float); }
	.scope::backdrop { background: rgb(0 0 0 / 35%); }
	h2 { font-size: 1.0625rem; font-weight: 600; margin-bottom: 0.75rem; }
	.options { display: flex; flex-direction: column; gap: 0.25rem; }
	label { display: flex; align-items: center; gap: 0.6rem; min-height: 2.5rem; padding: 0 0.5rem; border-radius: 10px; font-size: 0.875rem; cursor: pointer; }
	label:hover { background: var(--color-surface-muted); }
	input { accent-color: var(--color-accent); width: 1rem; height: 1rem; }
	footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
</style>

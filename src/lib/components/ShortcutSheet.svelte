<script lang="ts">
	import { SHORTCUTS } from '$lib/shortcuts';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const groups = $derived(
		['Move', 'Act', 'Write', 'Jump'].map((group) => ({
			group,
			items: SHORTCUTS.filter((item) => item.group === group)
		}))
	);
</script>

{#if open}
	<button type="button" class="scrim" data-overlay aria-label="Close shortcuts" onclick={() => (open = false)}
	></button>
	<div class="sheet" data-overlay role="dialog" aria-label="Keyboard shortcuts">
		<header>
			<h2>Shortcuts</h2>
			<p>The mailbox stays quiet. These are here when you want to go faster.</p>
		</header>
		<div class="grid">
			{#each groups as group (group.group)}
				<section>
					<h3>{group.group}</h3>
					<ul>
						{#each group.items as item (item.keys)}
							<li>
								<span>{item.action}</span>
								<kbd>{item.keys}</kbd>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: var(--color-scrim);
	}

	.sheet {
		position: fixed;
		top: 12vh;
		left: 50%;
		z-index: 80;
		width: min(40rem, calc(100vw - 2rem));
		max-height: 76vh;
		overflow: auto;
		padding: 1.25rem 1.35rem 1.5rem;
		transform: translateX(-50%);
		background: var(--color-surface);
		border-radius: 16px;
		box-shadow: var(--mat-float);
	}

	h2 {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	header p {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem 1.5rem;
		margin-top: 1.25rem;
	}

	h3 {
		margin-bottom: 0.375rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-muted);
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.3125rem 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	li:last-child {
		box-shadow: none;
	}

	kbd {
		flex-shrink: 0;
		padding: 0.0625rem 0.375rem;
		border-radius: 5px;
		font-size: 0.6875rem;
		color: var(--color-text);
		background: var(--color-well);
		box-shadow: var(--mat-well);
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>

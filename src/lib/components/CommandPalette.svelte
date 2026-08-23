<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		onSearch
	}: {
		open: boolean;
		onSearch: () => void;
	} = $props();

	type Command = {
		id: string;
		label: string;
		hint?: string;
		icon: string;
		run: () => void;
	};

	const commands = $derived<Command[]>([
		{
			id: 'compose',
			label: 'New message',
			hint: 'c',
			icon: 'pencil-line',
			run: () => goto('/compose')
		},
		{
			id: 'search',
			label: 'Search messages',
			hint: '/',
			icon: 'search-line',
			run: onSearch
		},
		{
			id: 'inbox',
			label: 'Go to inbox',
			hint: 'g i',
			icon: 'inbox-line',
			run: () => goto('/inbox')
		},
		{
			id: 'starred',
			label: 'Go to starred',
			hint: 'g s',
			icon: 'star-line',
			run: () => goto('/starred')
		},
		{
			id: 'drafts',
			label: 'Go to drafts',
			hint: 'g d',
			icon: 'draft-line',
			run: () => goto('/drafts')
		},
		{
			id: 'sent',
			label: 'Go to sent',
			hint: 'g t',
			icon: 'send-plane-line',
			run: () => goto('/sent')
		},
		{
			id: 'later',
			label: 'Go to later',
			hint: 'g b',
			icon: 'time-line',
			run: () => goto('/later')
		},
		{
			id: 'trash',
			label: 'Go to trash',
			hint: 'g e',
			icon: 'delete-bin-line',
			run: () => goto('/trash')
		},
		{
			id: 'settings',
			label: 'Open settings',
			icon: 'user-settings-line',
			run: () => goto('/settings')
		},
		{
			id: 'refresh',
			label: 'Refresh',
			icon: 'refresh-line',
			run: () => invalidateAll()
		}
	]);

	let query = $state('');
	let active = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	const filtered = $derived(
		commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()))
	);

	$effect(() => {
		if (open) {
			query = '';
			active = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	$effect(() => {
		if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
	});

	function run(command: Command) {
		open = false;
		command.run();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % Math.max(filtered.length, 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + filtered.length) % Math.max(filtered.length, 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const command = filtered[active];
			if (command) run(command);
		}
	}
</script>

{#if open}
	<button type="button" class="scrim" data-overlay aria-label="Close commands" onclick={() => (open = false)}
	></button>
	<div class="palette" data-overlay role="dialog" aria-label="Commands">
		<div class="search">
			<Icon name="search-line" size={16} />
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onKeydown}
				placeholder="Jump, compose, search…"
				aria-label="Filter commands"
			/>
			<kbd>esc</kbd>
		</div>
		<ul>
			{#each filtered as command, index (command.id)}
				<li>
					<button
						type="button"
						class="item"
						class:on={index === active}
						onclick={() => run(command)}
						onmouseenter={() => (active = index)}
					>
						<Icon name={command.icon} size={15} />
						<span>{command.label}</span>
						{#if command.hint}<kbd>{command.hint}</kbd>{/if}
					</button>
				</li>
			{:else}
				<li class="empty">Nothing matches</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: var(--color-scrim);
	}

	.palette {
		position: fixed;
		top: 18vh;
		left: 50%;
		z-index: 80;
		width: min(28rem, calc(100vw - 2rem));
		transform: translateX(-50%);
		background: var(--color-surface);
		border-radius: 16px;
		box-shadow: var(--mat-float);
		overflow: hidden;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0.875rem;
		color: var(--color-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.search input {
		flex: 1;
		min-width: 0;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
	}

	.item.on,
	.item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.item kbd,
	.search kbd {
		margin-left: auto;
		padding: 0.0625rem 0.3125rem;
		border-radius: 5px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-well);
		box-shadow: var(--mat-well);
	}

	.empty {
		padding: 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	ul {
		max-height: 18rem;
		overflow: auto;
		padding: 0.25rem 0;
	}
</style>

<script lang="ts">
	let {
		value = $bindable(''),
		placeholder = 'name@example.com',
		required = false,
		id = undefined
	}: {
		value: string;
		placeholder?: string;
		required?: boolean;
		id?: string;
	} = $props();

	let open = $state(false);
	let suggestions = $state<string[]>([]);
	let active = $state(0);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function currentToken(): { prefix: string; query: string } {
		const caret = value;
		const lastComma = caret.lastIndexOf(',');
		const query = caret.slice(lastComma + 1).trim();
		return { prefix: lastComma === -1 ? '' : caret.slice(0, lastComma + 1) + ' ', query };
	}

	function fetchSuggestions(query: string) {
		if (timer) clearTimeout(timer);
		if (query.length < 1) {
			suggestions = [];
			open = false;
			return;
		}
		timer = setTimeout(async () => {
			const res = await fetch(`/api/contacts?q=${encodeURIComponent(query)}`);
			if (!res.ok) return;
			const body = (await res.json()) as { contacts: { address: string }[] };
			suggestions = body.contacts.map((contact) => contact.address);
			active = 0;
			open = suggestions.length > 0;
		}, 80);
	}

	function onInput(event: Event) {
		value = (event.currentTarget as HTMLInputElement).value;
		fetchSuggestions(currentToken().query);
	}

	function choose(address: string) {
		const { prefix } = currentToken();
		value = `${prefix}${address}, `;
		suggestions = [];
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % suggestions.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + suggestions.length) % suggestions.length;
		} else if (event.key === 'Enter' && suggestions[active]) {
			event.preventDefault();
			choose(suggestions[active]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="wrap">
	<input
		{id}
		type="text"
		class="field-input"
		{value}
		{placeholder}
		{required}
		autocomplete="off"
		autocapitalize="none"
		spellcheck="false"
		oninput={onInput}
		onkeydown={onKeydown}
		onblur={() => setTimeout(() => (open = false), 120)}
	/>
	{#if open}
		<ul class="suggest" data-overlay>
			{#each suggestions as address, index (address)}
				<li>
					<button
						type="button"
						class="item"
						class:on={index === active}
						onmousedown={(event) => {
							event.preventDefault();
							choose(address);
						}}
					>
						{address}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.suggest {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 0.25rem);
		z-index: 40;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 12px;
		box-shadow: var(--mat-float);
	}

	.item {
		display: block;
		width: 100%;
		padding: 0.4375rem 0.625rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-text-secondary);
	}

	.item:hover,
	.item.on {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}
</style>

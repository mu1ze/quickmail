<script lang="ts">
	import Icon from './Icon.svelte';
	import { CATEGORY_LABELS } from '$lib/mail-analysis';
	let { value = '', onChange }: { value?: string; onChange: (value: string | null) => void } = $props();
	const categories = [
		{ value: '', label: 'All mail', icon: 'stack-line', detail: 'The whole picture', tone: 'mint' },
		{ value: 'primary', label: 'Primary', icon: 'user-heart-line', detail: 'People & conversations', tone: 'blue' },
		{ value: 'transactions', label: 'Transactions', icon: 'bank-card-line', detail: 'Orders & receipts', tone: 'amber' },
		{ value: 'promotions', label: 'Promotions', icon: 'price-tag-3-line', detail: 'Offers & discovery', tone: 'pink' },
		{ value: 'updates', label: 'Updates', icon: 'notification-3-line', detail: 'Keeping you in the loop', tone: 'violet' },
		{ value: 'newsletters', label: 'Newsletters', icon: 'article-line', detail: 'Ideas worth reading', tone: 'cyan' }
	];
	let menu = $state<HTMLDetailsElement | null>(null);
	const specific = $derived(value && !categories.some((category) => category.value === value));
	function choose(category: string | null) {
		if (menu) menu.open = false;
		onChange(category);
	}
</script>

<svelte:window
	onclick={(event) => { if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false; }}
	onkeydown={(event) => { if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary')?.focus(); } }}
/>

<nav class="categories" aria-label="Email categories">
	<div class="category-track">
		{#each categories as category}
			<button type="button" class="category" class:active={value === category.value}
				aria-label={category.label} aria-pressed={value === category.value} title={category.detail}
				style={`--category-tone:var(--category-${category.tone})`} onclick={() => choose(category.value || null)}>
				<span class="category-icon"><Icon name={category.icon} size={19} /></span>
				<span class="category-copy"><span class="category-name">{category.label}</span><span class="category-detail">{category.detail}</span></span>
				<span class="active-mark" aria-hidden="true"></span>
			</button>
		{/each}
	</div>
	<details class="more-categories" class:active={specific} bind:this={menu}>
		<summary aria-label="More categories" title="Specific categories"><Icon name="equalizer-2-line" size={18} /><span>{specific ? CATEGORY_LABELS[value as keyof typeof CATEGORY_LABELS] ?? 'Other' : 'More'}</span><Icon name="arrow-down-s-line" size={14} /></summary>
		<div class="category-menu">
			<p>Specific categories</p>
			{#each Object.entries(CATEGORY_LABELS) as [category, label]}
				<button type="button" class:chosen={value === category} aria-pressed={value === category} onclick={() => choose(category)}><span>{label}</span>{#if value === category}<Icon name="check-line" size={16} />{/if}</button>
			{/each}
		</div>
	</details>
</nav>

<style>
	.categories { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; margin: 0; position: relative; --category-mint: var(--color-accent-text); --category-blue: #548ac6; --category-amber: #a87b2e; --category-pink: #b66b93; --category-violet: #8d7bc6; --category-cyan: #408e99; }
	.category-track { display: flex; gap: 0.25rem; flex: 1; min-width: 0; padding: 0.25rem; border-radius: 14px; background: var(--color-well); overflow-x: auto; scrollbar-width: none; }
	.category-track::-webkit-scrollbar { display: none; }
	.category { display: flex; align-items: center; gap: 0.5rem; flex: none; position: relative; min-width: 0; padding: 0.4rem 0.85rem 0.4rem 0.6rem; border: 1px solid transparent; border-radius: 10px; text-align: left; transition: background 150ms, border-color 150ms, color 150ms; }
	.category:hover { background: var(--color-surface-hover); }
	.category.active { background: var(--color-surface); border-color: var(--color-line-strong); box-shadow: 0 3px 10px #00000008; }
	.category-icon { display: flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; color: var(--category-tone); }
	.category-copy { display: flex; min-width: 0; }
	.category-name { font-size: 0.8125rem; font-weight: 550; color: var(--color-text-secondary); white-space: nowrap; }
	.active .category-name { color: var(--color-text); }
	.category-detail { display: none; }
	.active-mark { display: none; }
	.more-categories { position: relative; flex: none; align-self: center; }
	summary { display: flex; align-items: center; justify-content: center; gap: 0.35rem; cursor: pointer; list-style: none; color: var(--color-muted); border-radius: 10px; padding: 0.45rem 0.6rem; font-size: 0.75rem; }
	summary::-webkit-details-marker { display: none; }
	summary:focus-visible { outline: 2px solid var(--color-focus-line); outline-offset: 3px; }
	.active summary, summary:hover { color: var(--color-accent-text); background: var(--color-accent-soft); }
	.category-menu { position: absolute; right: 0; top: calc(100% + 0.6rem); z-index: 44; width: 13rem; padding: 0.5rem; border: 1px solid var(--color-line); border-radius: 15px; box-shadow: var(--mat-float); background: var(--color-surface); }
	.category-menu p { padding: 0.5rem 0.65rem; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); }
	.category-menu button { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0.6rem 0.65rem; border-radius: 8px; text-align: left; color: var(--color-text-secondary); font-size: 0.8rem; }
	.category-menu button:hover, .category-menu button.chosen { background: var(--color-accent-soft); color: var(--color-accent-text); }
	:global(:root[data-theme='dark']) .categories { --category-blue: #83b2e5; --category-amber: #d6b16b; --category-pink: #d79bbc; --category-violet: #b4a3e6; --category-cyan: #7cbdc7; }
	@media (max-width: 1200px) { summary span { display: none; } }
	/* Desktop: a plain underline tab row that shares its line with the filters. */
	@media (min-width: 901px) {
		.category-track { gap: 0.125rem; padding: 0; border-radius: 0; background: transparent; }
		.category { height: 2.875rem; gap: 0.375rem; padding: 0 0.625rem; border: 0; border-radius: 0; }
		.category:hover { background: transparent; }
		.category:hover .category-name { color: var(--color-text); }
		.category.active { background: transparent; box-shadow: inset 0 -2px 0 var(--color-accent); }
		.category.active .category-name { font-weight: 600; }
		.category-icon { display: none; }
		summary { padding: 0.4rem 0.5rem; }
	}
	@media (min-width: 901px) and (max-width: 1280px) { .category { padding: 0 0.4rem; } .category-name { font-size: 0.78rem; } }
	@media (max-width: 900px) {
		.categories { margin: 0.35rem 1rem 0.75rem; gap: 0.3rem; }
		.category-track { display: flex; overflow-x: auto; scrollbar-width: none; border-radius: 13px; gap: 0.2rem; padding: 0.25rem; }
		.category-track::-webkit-scrollbar { display: none; }
		.category { flex: none; flex-direction: row; align-items: center; gap: 0.4rem; padding: 0.5rem 0.65rem; border-radius: 9px; }
		.category-icon { width: 1.4rem; height: 1.4rem; background: transparent; }
		.category-name { white-space: nowrap; font-size: 0.75rem; }
		.active-mark { display: none; }
		summary { min-height: 2.75rem; padding: 0.45rem; }
	}
</style>

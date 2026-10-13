<script lang="ts">
	import { page } from '$app/stores';
	let { children }: { children: import('svelte').Snippet } = $props();
	const composeKey = $derived($page.url.searchParams.get('draft') ?? $page.url.searchParams.get('forward') ?? 'new');
</script>

{#key composeKey}
	{@render children()}
{/key}

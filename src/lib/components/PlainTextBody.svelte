<script lang="ts">
	import { textParts } from '$lib/utils/text-links';
	let { text }: { text: string } = $props();
</script>

<p class="plain-text">{#each textParts(text) as part}{#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else}{part.text}{/if}{/each}</p>

<style>
	.plain-text { white-space: pre-wrap; overflow-wrap: anywhere; }
	a { color: var(--color-accent-text); text-decoration: underline; text-underline-offset: 2px; }
</style>

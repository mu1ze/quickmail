<script lang="ts">
	import { CATEGORY_LABELS, type MailAnalysis } from '$lib/mail-analysis';
	let { analysis }: { analysis?: MailAnalysis } = $props();
</script>

{#if analysis}
	<span class="analysis-badges" aria-label="Email analysis">
		{#if analysis.category}<span class="badge" title={analysis.corrected ? 'Your category correction' : 'Suggested category'}>{CATEGORY_LABELS[analysis.category]}</span>{/if}
		{#if analysis.phishing}<span class="badge warning">Possible phishing</span>{/if}
		{#if analysis.spam}<span class="badge warning">Suspected spam</span>{/if}
		{#if analysis.review && !analysis.phishing && !analysis.spam}<span class="badge">{analysis.status === 'failed' ? 'Analysis failed · Review' : 'Review'}</span>{/if}
		{#if analysis.needsReply}<span class="badge">Reply suggested</span>{/if}
		{#if analysis.deadline}<span class="badge">Deadline mentioned</span>{/if}
		{#if analysis.status === 'pending'}<span class="badge">Analysis pending</span>{/if}
	</span>
{/if}

<style>
	.analysis-badges { display:flex; flex-wrap:wrap; gap:0.3rem; min-width:0; }
	.badge { display:inline-flex; font-size:0.6875rem; line-height:1.5; padding:0.1rem 0.4rem; border-radius:5px; color:var(--color-text-secondary); background:var(--color-well); }
	.warning { color:var(--color-text); border:1px solid var(--color-text-secondary); font-weight:600; }
</style>

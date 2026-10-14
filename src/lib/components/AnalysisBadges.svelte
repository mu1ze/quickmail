<script lang="ts">
	import { CATEGORY_LABELS, type MailAnalysis, type MailCategory } from '$lib/mail-analysis';
	let { analysis }: { analysis?: MailAnalysis } = $props();
	// Same hues as the mailbox tabs, so a chip reads as "belongs to that tab".
	const TONE: Record<MailCategory, string> = {
		personal: 'blue', work: 'blue', support: 'blue', transaction: 'amber', promotion: 'pink', sales_outreach: 'pink',
		notification: 'violet', security_alert: 'violet', newsletter: 'cyan', other: 'gray'
	};
</script>

{#if analysis}
	<span class="analysis-badges" aria-label="Email analysis">
		{#if analysis.category}<span class="badge tone-{TONE[analysis.category]}" title={analysis.corrected ? 'Your category correction' : 'Suggested category'}>{CATEGORY_LABELS[analysis.category]}</span>{/if}
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
	.badge[class*='tone-'] { color: color-mix(in srgb, var(--tone) 78%, var(--color-text)); background: color-mix(in srgb, var(--tone) 14%, transparent); }
	.tone-blue { --tone: #548ac6; } .tone-amber { --tone: #a87b2e; } .tone-pink { --tone: #b66b93; }
	.tone-violet { --tone: #8d7bc6; } .tone-cyan { --tone: #408e99; } .tone-gray { --tone: var(--color-text-secondary); }
	:global(:root[data-theme='dark']) .tone-blue { --tone: #83b2e5; } :global(:root[data-theme='dark']) .tone-amber { --tone: #d6b16b; }
	:global(:root[data-theme='dark']) .tone-pink { --tone: #d79bbc; } :global(:root[data-theme='dark']) .tone-violet { --tone: #b4a3e6; }
	:global(:root[data-theme='dark']) .tone-cyan { --tone: #7cbdc7; }
	.warning { color:var(--color-text); border:1px solid var(--color-text-secondary); font-weight:600; }
</style>

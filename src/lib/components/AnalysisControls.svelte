<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { CATEGORY_LABELS, type MailAnalysis } from '$lib/mail-analysis';
	let { analysis, categoryId, warningIds = [], taskIds = [] }: { analysis: MailAnalysis; categoryId: string; warningIds?: string[]; taskIds?: string[] } = $props();
	let busy = $state(false), error = $state('');
	async function update(ids: string[], input: Record<string, unknown>) {
		busy=true;error='';
		try {
			for (const id of new Set(ids)) {
				const res=await fetch(`/api/mail/${encodeURIComponent(id)}/analysis`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
				if (!res.ok) throw new Error((await res.json()).error ?? 'Could not save correction');
			}
			await invalidateAll();
		} catch(e) {error=e instanceof Error?e.message:'Could not save correction';}
		finally {busy=false;}
	}
</script>

<div class="analysis-controls">
	<label>Category
		<select aria-label="Correct email category" disabled={busy} value={analysis.category ?? ''} onchange={(e)=>update([categoryId],{category:e.currentTarget.value || null})}>
			<option value="">Use model suggestion</option>
			{#each Object.entries(CATEGORY_LABELS) as [value,label]}<option {value}>{label}</option>{/each}
		</select>
	</label>
	{#if analysis.phishing || analysis.spam}<button type="button" disabled={busy} onclick={()=>update(warningIds.length?warningIds:[categoryId],{warningDismissed:true})}>Dismiss warning</button>{/if}
	{#if analysis.needsReply || analysis.deadline}<button type="button" disabled={busy} onclick={()=>update(taskIds.length?taskIds:[categoryId],{taskDone:true})}>Mark task done</button>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
	.analysis-controls { padding:0.6rem; display:flex; flex-direction:column; gap:0.5rem; border-bottom:1px solid var(--color-line); font-size:0.8125rem; }
	label { display:flex; flex-direction:column; gap:0.3rem; color:var(--color-text-secondary); }
	select { width:100%; min-width:0; min-height:2.5rem; border:1px solid var(--color-line); border-radius:6px; padding:0.4rem; background:var(--color-surface); color:var(--color-text); }
	button { text-align:left; min-height:2.5rem; padding:0.4rem; border-radius:6px; }
	button:hover { background:var(--color-well); }
	p { margin:0; }
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import GroupedPanel from './hub/GroupedPanel.svelte';
	let enabled=$state(false),available=$state(false),loading=$state(true),busy=$state(false),zdrConfirmed=$state(false);
	let error=$state(''),notice=$state(''),providerError=$state<string|null>(null);
	let corrections=$state<{band:string;reviewed:number;agreed:number}[]>([]);
	const providerErrors:Record<string,string>={subq_http_401:'The SubQ key is invalid.',subq_http_402:'SubQ credits are exhausted.',subq_http_403:'The SubQ key cannot access this model.',subq_http_429:'SubQ rate limits were reached.'};
	let counts=$state<{status:string;count:number}[]>([]);
	async function refresh() {
		try {
			const res=await fetch('/api/settings/analysis');if(!res.ok) throw Error('Could not load analysis settings');
			const data=await res.json();enabled=data.enabled;available=data.available;counts=data.counts;corrections=data.corrections;providerError=data.providerError;
		} catch(e){error=e instanceof Error?e.message:'Could not load settings';}finally{loading=false;}
	}
	onMount(()=>{void refresh();});
	async function change(next:boolean) {
		busy=true;error='';notice='';
		try {
			const res=await fetch('/api/settings/analysis',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:next,zdrConfirmed})});
			const data=await res.json();if(!res.ok) throw Error(data.error);
			enabled=data.enabled;notice=enabled?'Incoming analysis enabled. Existing messages are processed only when you request it.':'Incoming analysis disabled. Pending jobs canceled.';await refresh();
		} catch(e){error=e instanceof Error?e.message:'Could not save settings';}finally{busy=false;}
	}
	async function queue(action:'backfill'|'retry') {
		busy=true;error='';notice='';
		try {
			const res=await fetch('/api/settings/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
			const data=await res.json();if(!res.ok)throw Error(data.error);
			notice=`${data.queued} message${data.queued===1?'':'s'} queued for analysis`;await refresh();
		}catch(e){error=e instanceof Error?e.message:'Could not queue analysis';}finally{busy=false;}
	}
</script>

<GroupedPanel title="Incoming email analysis" hint="SubQ suggests categories and flags possible phishing, spam, replies, and deadlines. Mail stays in its current folder and keeps its read state. Weekly cleanup is a separate feature.">
	<div class="analysis-settings">
		<p>When enabled, sender and recipient details, selected headers, cleaned message text, link destinations, and attachment names are sent to SubQ. Attachment contents are excluded. Suggestions can be wrong; unflagged mail is not verified safe.</p>
		{#if loading}<p>Loading settings…</p>{:else if !available}<p>SubQ is unavailable. Configure the server API key to enable analysis.</p>{/if}
		{#if !enabled}<label><input type="checkbox" bind:checked={zdrConfirmed} disabled={busy || loading} />I confirm zero data retention is active for the SubQ organization used by this app.</label>{/if}
		<label><input type="checkbox" role="switch" aria-label="Analyze incoming email" checked={enabled} disabled={busy || loading || (!enabled && (!available || !zdrConfirmed))} onchange={(e)=>change(e.currentTarget.checked)} />Analyze all incoming email for my account</label>
		<div class="buttons">
			<button class="btn-ghost" type="button" disabled={!enabled || !available || busy} onclick={()=>queue('backfill')}>Analyze up to 200 existing emails</button>
			<button class="btn-ghost" type="button" disabled={!enabled || !available || busy} onclick={()=>queue('retry')}>Retry failed analysis</button>
			<button class="btn-ghost" type="button" disabled={busy} onclick={refresh}>Refresh status</button>
		</div>
		{#if counts.length}<p>{counts.map(c=>`${c.count} ${c.status}`).join(' · ')}</p>{/if}
		{#each corrections as band}<p>Reviewed categories {band.band}: {band.agreed}/{band.reviewed} agree with the model. Only manually reviewed messages are counted.</p>{/each}
		{#if providerError}<p role="status">Processing paused. {providerErrors[providerError] ?? 'SubQ is temporarily unavailable.'} Fix the cause before retrying. Processing resumes after the retry delay.</p>{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		{#if notice}<p role="status">{notice}</p>{/if}
	</div>
</GroupedPanel>

<style>
	.analysis-settings { padding:1rem; display:flex; flex-direction:column; gap:0.8rem; font-size:0.875rem; }
	p { margin:0; color:var(--color-text-secondary); line-height:1.6; }
	label { display:flex; align-items:flex-start; gap:0.6rem; }
	input { flex-shrink:0; margin-top:0.2rem; }
	.buttons { display:flex; gap:0.5rem; flex-wrap:wrap; }
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import GroupedPanel from './hub/GroupedPanel.svelte';
	import SettingRow from './settings/SettingRow.svelte';
	import StatusBanner from './settings/StatusBanner.svelte';
	import Icon from './Icon.svelte';
	let enabled=$state(false),available=$state(false),loading=$state(true),busy=$state(false);
	let remaining=$state(0),backfillAll=$state(false);
	let error=$state(''),notice=$state(''),providerError=$state<string|null>(null);
	let corrections=$state<{band:string;reviewed:number;agreed:number}[]>([]);
	const providerErrors:Record<string,string>={subq_http_401:'The SubQ key is invalid.',subq_http_402:'SubQ credits are exhausted.',subq_http_403:'The SubQ key cannot access this model.',subq_http_429:'SubQ rate limits were reached.'};
	let counts=$state<{status:string;count:number}[]>([]);
	async function refresh() {
		try {
			const res=await fetch('/api/settings/analysis');if(!res.ok) throw Error('Could not load analysis settings');
			const data=await res.json();enabled=data.enabled;available=data.available;counts=data.counts;remaining=data.remaining;backfillAll=data.backfillAll;corrections=data.corrections;providerError=data.providerError;
		} catch(e){error=e instanceof Error?e.message:'Could not load settings';}finally{loading=false;}
	}
	onMount(()=>{
		void refresh();
		// Follow progress while analysis is running; stay quiet otherwise.
		const timer=setInterval(()=>{ if(!document.hidden && (backfillAll || counts.some(c=>c.status==='pending'||c.status==='processing'))) void refresh(); },5000);
		return ()=>clearInterval(timer);
	});
	const open=$derived(counts.filter(c=>c.status==='pending'||c.status==='processing').reduce((n,c)=>n+c.count,0));
	let showDetails=$state(false);
	const existingSummary=$derived(
		loading ? 'Checking…'
		: backfillAll ? `Analyzing in batches of 200: ${remaining} not yet queued, ${open} in progress. This continues if you leave the page.`
		: !enabled ? 'Turn on analysis to categorize what is already in your mailbox.'
		: remaining>0 ? `${remaining} message${remaining===1?' has':'s have'} not been analyzed yet.`
		: 'All existing mail has been analyzed.'
	);
	async function change(next:boolean) {
		busy=true;error='';notice='';
		try {
			const res=await fetch('/api/settings/analysis',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:next})});
			const data=await res.json();if(!res.ok) throw Error(data.error);
			enabled=data.enabled;notice=enabled?'Incoming analysis enabled. Use “Analyze all existing emails” to categorize what is already in your mailbox.':'Incoming analysis disabled. Pending jobs canceled.';await refresh();
		} catch(e){error=e instanceof Error?e.message:'Could not save settings';}finally{busy=false;}
	}
	async function queue(action:'backfill'|'backfill-all'|'stop-backfill'|'retry') {
		busy=true;error='';notice='';
		try {
			const res=await fetch('/api/settings/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
			const data=await res.json();if(!res.ok)throw Error(data.error);
			notice=action==='stop-backfill'?'Stopped. Messages already queued will still finish.':`${data.queued} message${data.queued===1?'':'s'} queued for analysis`;await refresh();
		}catch(e){error=e instanceof Error?e.message:'Could not queue analysis';}finally{busy=false;}
	}
</script>

{#if !loading && !available}
	<StatusBanner title="Email analysis is unavailable">
		The server has no SubQ API key. Add it as a Worker secret, then reload this page.
	</StatusBanner>
{:else if providerError}
	<StatusBanner title="Analysis is paused">
		{providerErrors[providerError] ?? 'SubQ is temporarily unavailable.'} Fix the cause, then retry. Processing resumes after the retry delay.
	</StatusBanner>
{/if}

<GroupedPanel title="Email analysis" hint="Suggestions can be wrong. Unflagged mail is not verified safe." flush>
	<SettingRow
		label="Analyze incoming mail"
		id="analysis-enabled"
		description="Suggest categories and flag phishing, spam, replies and deadlines. Mail stays in its folder and keeps its read state."
	>
		{#snippet control()}
			<input id="analysis-enabled" class="switch" type="checkbox" role="switch" checked={enabled} disabled={busy || loading || (!enabled && !available)} onchange={(e)=>change(e.currentTarget.checked)} />
		{/snippet}
	</SettingRow>
	<SettingRow label="What gets sent" description="Sender, recipients, a few headers, cleaned text, link destinations and attachment names. Never attachment contents.">
		{#snippet control()}
			<button class="btn-ghost" type="button" aria-expanded={showDetails} onclick={()=>showDetails=!showDetails}>{showDetails ? 'Hide' : 'Details'}</button>
		{/snippet}
		{#if showDetails}
			<p>When enabled, sender and recipient details, selected headers, cleaned message text, link destinations, and attachment names are sent to SubQ for this account. Attachment contents are excluded.</p>
		{/if}
	</SettingRow>
	<SettingRow label="Existing mail" description={existingSummary}>
		{#snippet control()}
			{#if backfillAll}
				<button class="btn-ghost" type="button" disabled={busy} onclick={()=>queue('stop-backfill')}>Stop</button>
			{:else}
				<button class="btn-ghost" type="button" disabled={!enabled || !available || busy || remaining===0} onclick={()=>queue('backfill-all')}>Analyze {remaining>0 ? remaining : 'all'}</button>
			{/if}
		{/snippet}
	</SettingRow>
	{#if counts.length || corrections.length}
		<SettingRow label="Status" description={counts.map(c=>`${c.count} ${c.status}`).join(' · ')}>
			{#snippet control()}
				<button class="btn-ghost" type="button" disabled={!enabled || !available || busy} onclick={()=>queue('retry')}>Retry failed</button>
				<button class="btn-ghost" type="button" disabled={busy} onclick={refresh} aria-label="Refresh status"><Icon name="refresh-line" size={16} /></button>
			{/snippet}
			{#each corrections as band}<p>Reviewed categories {band.band}: {band.agreed}/{band.reviewed} agree with the model.</p>{/each}
		</SettingRow>
	{/if}
</GroupedPanel>
{#if error}<p class="analysis-message error" role="alert">{error}</p>{/if}
{#if notice}<p class="analysis-message" role="status">{notice}</p>{/if}

<style>
	.analysis-message { margin: 0.625rem 0.25rem 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.analysis-message.error { color: var(--color-danger); }
</style>

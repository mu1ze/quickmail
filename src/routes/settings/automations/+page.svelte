<script lang="ts">
	import AnalysisSettings from '$lib/components/AnalysisSettings.svelte';
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	type RuleField = 'from' | 'domain' | 'subject';
	type RuleAction = 'keep' | 'trash';
	type AutomationRule = { id: string; field: RuleField; value: string; action: RuleAction };

	let { data }: { data: PageData } = $props();

	let codeCleanup = $state(untrack(() => data.automations.codeCleanup));
	let savedCodeCleanup = $state(untrack(() => data.automations.codeCleanup));
	let weeklyCleanup = $state(data.automations.weeklyCleanup);
	let aiClassify = $state(data.automations.aiClassify);
	let aiSummaries = $state(data.automations.aiSummaries);
	let rules = $state<AutomationRule[]>(data.automations.rules.map((rule) => ({ ...rule })));
	let lastCleanupAt = $state(data.automations.lastCleanupAt);
	let lastCleanupTrashed = $state(data.automations.lastCleanupTrashed);
	let busy = $state(false);
	let runBusy = $state(false);
	let error = $state('');
	let notice = $state('');

	const aiAvailable = data.automations.aiAvailable;

	// Toggles save as soon as they change; rule edits wait for an explicit save.
	const serializeRules = (list: AutomationRule[]) => JSON.stringify(list.map(({ field, value, action }) => ({ field, value: value.trim(), action })));
	let savedRules = $state<AutomationRule[]>(data.automations.rules.map((rule) => ({ ...rule })));
	const rulesDirty = $derived(serializeRules(rules) !== serializeRules(savedRules));

	function discardRules() {
		rules = savedRules.map((rule) => ({ ...rule }));
	}

	function cleanRules(list: AutomationRule[]) {
		return list
			.map((rule) => ({ id: rule.id, field: rule.field, value: rule.value.trim(), action: rule.action }))
			.filter((rule) => rule.value.length > 0);
	}

	function addRule() {
		rules = [
			...rules,
			{ id: crypto.randomUUID(), field: 'domain', value: '', action: 'trash' }
		];
	}

	function removeRule(id: string) {
		rules = rules.filter((rule) => rule.id !== id);
	}

	async function readError(res: Response): Promise<string> {
		try {
			const body = (await res.json()) as { error?: string };
			return body.error ?? 'Request failed';
		} catch {
			return 'Request failed';
		}
	}

	/** Saves the toggles; rule edits are only included when the rules panel asks for it. */
	async function save(includeRules = false) {
		busy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/automations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					codeCleanup,
					weeklyCleanup,
					aiClassify,
					aiSummaries,
					rules: cleanRules(includeRules ? rules : savedRules)
				})
			});
			if (!res.ok) {
				error = await readError(res);
				codeCleanup = savedCodeCleanup;
				return;
			}
			const saved = (await res.json()) as typeof data.automations;
			weeklyCleanup = saved.weeklyCleanup;
			codeCleanup = saved.codeCleanup;
			savedCodeCleanup = saved.codeCleanup;
			aiClassify = saved.aiClassify;
			aiSummaries = saved.aiSummaries;
			savedRules = saved.rules.map((rule) => ({ ...rule }));
			if (includeRules) rules = savedRules.map((rule) => ({ ...rule }));
			lastCleanupAt = saved.lastCleanupAt;
			lastCleanupTrashed = saved.lastCleanupTrashed;
			notice = 'Saved';
		} catch {
			error = 'Network error';
			codeCleanup = savedCodeCleanup;
		} finally {
			busy = false;
		}
	}

	async function runNow() {
		runBusy = true;
		error = '';
		notice = '';
		try {
			const saveRes = await fetch('/api/settings/automations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					codeCleanup,
					weeklyCleanup,
					aiClassify,
					aiSummaries,
					rules: cleanRules(savedRules)
				})
			});
			if (!saveRes.ok) {
				error = await readError(saveRes);
				return;
			}

			const res = await fetch('/api/settings/automations/run', { method: 'POST' });
			if (!res.ok) {
				error = await readError(res);
				return;
			}
			const result = (await res.json()) as {
				scanned: number;
				trashed: number;
				summarized: number;
				lastCleanupAt: string | null;
				lastCleanupTrashed: number;
			};
			lastCleanupAt = result.lastCleanupAt;
			lastCleanupTrashed = result.lastCleanupTrashed;
			notice = `Scanned ${result.scanned} opened messages, moved ${result.trashed} to Trash${
				result.summarized ? `, wrote ${result.summarized} summaries` : ''
			}.`;
		} catch {
			error = 'Network error';
		} finally {
			runBusy = false;
		}
	}

	function formatLastRun(value: string | null): string {
		if (!value) return 'Not run yet';
		const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString();
	}
</script>

<svelte:head>
	<title>Automations — Settings</title>
</svelte:head>

<HubShell
	title="Automations"
	backHref="/settings"
	description="Let QuickMail sort, flag and tidy incoming mail. Nothing is deleted without passing through Trash."
>
	<AnalysisSettings />

	<GroupedPanel title="One-time codes" hint="Keep the inbox clear after signing in. Only the code email moves to Trash; other messages in the conversation stay put." flush>
		<SettingRow label="Auto-trash after 5 minutes" id="code-cleanup" description="New code emails, including unread mail, move to Trash five minutes after arrival. Checked every minute. Turning this off cancels pending cleanup.">
			{#snippet control()}
				<input id="code-cleanup" class="switch" type="checkbox" role="switch" bind:checked={codeCleanup} disabled={busy || runBusy} onchange={() => save()} />
			{/snippet}
		</SettingRow>
		<p class="empty code-cleanup-note">Existing mail stays unchanged. Starred, pinned, archived and snoozed mail, restored emails and Never auto-trash rules are kept.</p>
	</GroupedPanel>

	<GroupedPanel
		title="Weekly cleanup"
		hint="Every message still arrives in your inbox. Opened promotions and mail matching your rules move to Trash, where you can restore them."
		flush
	>
		<SettingRow label="Clean up every Sunday" id="weekly-cleanup" description="Opened mail only. Unread messages are never touched.">
			{#snippet control()}
				<input id="weekly-cleanup" class="switch" type="checkbox" role="switch" bind:checked={weeklyCleanup} disabled={busy} onchange={() => save()} />
			{/snippet}
		</SettingRow>
		<SettingRow
			label="Second pass with AI"
			id="ai-classify"
			description={aiAvailable
				? 'Classifies leftover bulk mail. Skipped when the model is unsure.'
				: 'Needs the Workers AI binding. Heuristics and rules still run without it.'}
		>
			{#snippet control()}
				<input id="ai-classify" class="switch" type="checkbox" role="switch" bind:checked={aiClassify} disabled={busy || !weeklyCleanup} onchange={() => save()} />
			{/snippet}
		</SettingRow>
		<SettingRow label="Inbox summaries" id="ai-summaries" description="Show a short summary instead of the snippet on threads you have opened. Needs Workers AI.">
			{#snippet control()}
				<input id="ai-summaries" class="switch" type="checkbox" role="switch" bind:checked={aiSummaries} disabled={busy} onchange={() => save()} />
			{/snippet}
		</SettingRow>
		<SettingRow
			label="Last run"
			description={lastCleanupAt ? `${formatLastRun(lastCleanupAt)} · ${lastCleanupTrashed} moved to Trash` : 'Not run yet'}
		>
			{#snippet control()}
				<button
					type="button"
					class="btn-ghost"
					disabled={runBusy || busy || (!weeklyCleanup && !aiSummaries)}
					onclick={runNow}
				>
					{runBusy ? 'Running…' : 'Run now'}
				</button>
			{/snippet}
		</SettingRow>
	</GroupedPanel>

	<GroupedPanel title="Your rules" hint="Keep rules always win. Trash rules run before the promotions scan.">
		{#snippet actions()}
			<button type="button" class="btn-ghost" onclick={addRule}>
				<Icon name="add-line" size={16} /> Add rule
			</button>
		{/snippet}
		{#if rules.length === 0}
			<p class="empty">No rules yet. Add one to always keep, or always trash, mail from a sender, domain or subject.</p>
		{:else}
			<ul class="rule-list">
				{#each rules as rule (rule.id)}
					<li class="rule-row">
						<select class="text-input" aria-label="Match field" bind:value={rule.field}>
							<option value={'from' satisfies RuleField}>From contains</option>
							<option value={'domain' satisfies RuleField}>Domain is</option>
							<option value={'subject' satisfies RuleField}>Subject contains</option>
						</select>
						<input
							class="text-input"
							type="text"
							aria-label="Match value"
							placeholder="promo.example"
							bind:value={rule.value}
						/>
						<select class="text-input" aria-label="Rule action" bind:value={rule.action}>
							<option value={'trash' satisfies RuleAction}>Move to Trash</option>
							<option value={'keep' satisfies RuleAction}>Never auto-trash</option>
						</select>
						<button type="button" class="icon-btn" aria-label="Remove rule" onclick={() => removeRule(rule.id)}>
							<Icon name="close-line" size={16} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if rulesDirty}
			<div class="rule-actions">
				<span>Unsaved rule changes</span>
				<button type="button" class="btn-ghost" disabled={busy} onclick={discardRules}>Discard</button>
				<button type="button" class="btn-primary" disabled={busy} onclick={() => save(true)}>{busy ? 'Saving…' : 'Save rules'}</button>
			</div>
		{/if}
	</GroupedPanel>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice}<p class="saved" role="status">{notice}</p>{/if}
</HubShell>

<style>
	.code-cleanup-note { padding: 0.875rem 1rem; line-height: 1.5; border-top: 1px solid var(--color-line); }









	.empty {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.rule-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.rule-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		box-shadow: inset 0 1px 0 var(--color-line);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.rule-actions span {
		margin-right: auto;
	}

	.rule-row {
		display: grid;
		grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr) minmax(0, 9rem) auto;
		gap: 0.5rem;
		align-items: center;
	}

	.text-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}



	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.saved {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}

	@media (max-width: 640px) {
		.rule-row {
			grid-template-columns: 1fr;
		}
	}
</style>

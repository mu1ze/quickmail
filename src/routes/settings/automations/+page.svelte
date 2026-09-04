<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import GroupedPanel from '$lib/components/hub/GroupedPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	type RuleField = 'from' | 'domain' | 'subject';
	type RuleAction = 'keep' | 'trash';
	type AutomationRule = { id: string; field: RuleField; value: string; action: RuleAction };

	let { data }: { data: PageData } = $props();

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

	async function save() {
		busy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/automations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					weeklyCleanup,
					aiClassify,
					aiSummaries,
					rules: rules
						.map((rule) => ({
							id: rule.id,
							field: rule.field,
							value: rule.value.trim(),
							action: rule.action
						}))
						.filter((rule) => rule.value.length > 0)
				})
			});
			if (!res.ok) {
				error = await readError(res);
				return;
			}
			const saved = (await res.json()) as typeof data.automations;
			weeklyCleanup = saved.weeklyCleanup;
			aiClassify = saved.aiClassify;
			aiSummaries = saved.aiSummaries;
			rules = saved.rules.map((rule) => ({ ...rule }));
			lastCleanupAt = saved.lastCleanupAt;
			lastCleanupTrashed = saved.lastCleanupTrashed;
			notice = 'Automations saved';
		} catch {
			error = 'Network error';
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
					weeklyCleanup,
					aiClassify,
					aiSummaries,
					rules: rules
						.map((rule) => ({
							id: rule.id,
							field: rule.field,
							value: rule.value.trim(),
							action: rule.action
						}))
						.filter((rule) => rule.value.length > 0)
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

<HubShell title="Automations" backHref="/settings">
	<GroupedPanel
		hint="Every message still arrives in your inbox. Once a week, mail you have already opened is scanned. Promotions and mail matching your rules move to Trash, where you can restore them."
	>
		<label class="toggle-row">
			<span>
				<span class="toggle-title">Weekly cleanup</span>
				<span class="toggle-hint">Sunday, opened mail only. Unread messages are never touched.</span>
			</span>
			<input
				class="switch"
				type="checkbox"
				role="switch"
				aria-label="Weekly cleanup"
				bind:checked={weeklyCleanup}
			/>
		</label>

		<label class="toggle-row">
			<span>
				<span class="toggle-title">Use AI to classify</span>
				<span class="toggle-hint">
					{#if aiAvailable}
						Optional second pass on leftover bulk mail. Skipped when the model is unsure.
					{:else}
						Needs the Workers AI binding. Heuristics and rules still run without it.
					{/if}
				</span>
			</span>
			<input
				class="switch"
				type="checkbox"
				role="switch"
				aria-label="Use AI to classify"
				bind:checked={aiClassify}
				disabled={!weeklyCleanup}
			/>
		</label>

		<label class="toggle-row">
			<span>
				<span class="toggle-title">AI inbox summaries</span>
				<span class="toggle-hint">
					Replace the snippet on opened threads with a short summary. No-op without Workers AI.
				</span>
			</span>
			<input
				class="switch"
				type="checkbox"
				role="switch"
				aria-label="AI inbox summaries"
				bind:checked={aiSummaries}
			/>
		</label>
	</GroupedPanel>

	<GroupedPanel
		title="Your rules"
		hint="Keep rules always win. Trash rules run before the built-in promo scan."
	>
		{#if rules.length === 0}
			<p class="empty">No custom rules yet.</p>
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
						<button type="button" class="btn-ghost" onclick={() => removeRule(rule.id)}>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<button type="button" class="btn-ghost add-rule" onclick={addRule}>
			<Icon name="add-line" size={16} /> Add rule
		</button>
	</GroupedPanel>

	<GroupedPanel>
		<p class="status">
			Last cleanup: {formatLastRun(lastCleanupAt)}
			{#if lastCleanupAt}
				· {lastCleanupTrashed} moved to Trash
			{/if}
		</p>
		<div class="actions">
			<button type="button" class="btn-primary" disabled={busy} onclick={save}>
				{busy ? 'Saving…' : 'Save'}
			</button>
			<button
				type="button"
				class="btn-ghost"
				disabled={runBusy || busy || (!weeklyCleanup && !aiSummaries)}
				onclick={runNow}
			>
				{runBusy ? 'Running…' : 'Run cleanup now'}
			</button>
		</div>
		{#if error}<p class="error" aria-live="polite">{error}</p>{/if}
		{#if notice}<p class="saved" aria-live="polite">{notice}</p>{/if}
	</GroupedPanel>
</HubShell>

<style>
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0;
	}

	.toggle-row + .toggle-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.toggle-title {
		display: block;
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.toggle-hint {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-muted);
	}

	.switch {
		flex-shrink: 0;
		width: 2.5rem;
		height: 1.5rem;
		appearance: none;
		border-radius: 999px;
		background: var(--color-line);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s;
	}

	.switch::after {
		content: '';
		display: block;
		width: 1.125rem;
		height: 1.125rem;
		margin: 0.1875rem;
		border-radius: 999px;
		background: var(--color-surface);
		transition: transform 0.15s;
	}

	.switch:checked {
		background: var(--color-accent);
	}

	.switch:checked::after {
		transform: translateX(1rem);
	}

	.switch:disabled {
		opacity: 0.4;
	}

	.empty,
	.status {
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

	.add-rule {
		margin-top: 0.75rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
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

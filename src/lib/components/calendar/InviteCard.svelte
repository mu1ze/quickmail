<script lang="ts">
	import { formatEventWhen } from '$lib/calendar/format';
	import { zonedParts } from '$lib/calendar/time';
	import type { AttendeeStatus } from '$lib/calendar/types';
	import { requestError, requireOk } from '$lib/utils/request';
	import Icon from '../Icon.svelte';

	/** Mirrors `InviteView` in calendar-invites.ts. */
	type Invite = {
		method: string;
		title: string;
		location: string;
		allDay: boolean;
		start: string;
		end: string;
		timeZone: string;
		repeat: string | null;
		repeatSimplified: boolean;
		organizer: { email: string; name: string | null } | null;
		attendeeCount: number;
		myStatus: AttendeeStatus | null;
		eventId: string | null;
		mine: boolean;
		outdated: boolean;
		reply: { email: string; name: string | null; status: AttendeeStatus } | null;
		canceled: boolean;
	};

	let { emailId }: { emailId: string } = $props();

	let invite = $state<Invite | null>(null);
	let failed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const viewerZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC';

	$effect(() => {
		const id = emailId;
		invite = null;
		failed = false;
		fetch(`/api/calendar/invites/${encodeURIComponent(id)}`)
			.then(async (response) => {
				if (!response.ok) throw new Error();
				invite = ((await response.json()) as { invite: Invite }).invite;
			})
			.catch(() => (failed = true));
	});

	const when = $derived(invite ? formatEventWhen(invite, invite.allDay ? 'UTC' : viewerZone, { withZone: false }) : '');
	const day = $derived(invite ? (invite.allDay ? invite.start : zonedParts(Date.parse(invite.start), viewerZone).date) : '');
	const answerable = $derived(Boolean(invite && !invite.canceled && !invite.mine && (invite.method === 'REQUEST' || invite.method === 'PUBLISH')));
	const REPLY_TEXT: Record<AttendeeStatus, string> = { accepted: 'accepted', tentative: 'might attend', declined: 'declined', 'needs-action': 'has not answered' };
	const STATUS_TEXT: Record<AttendeeStatus, string> = { accepted: "You're going", tentative: 'You might go', declined: "You're not going", 'needs-action': '' };

	async function respond(status: 'accepted' | 'tentative' | 'declined') {
		busy = true;
		error = '';
		notice = '';
		try {
			const response = await fetch(`/api/calendar/invites/${encodeURIComponent(emailId)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: status })
			});
			await requireOk(response);
			const body = (await response.json()) as { invite: Invite; warnings?: string[] };
			invite = body.invite;
			notice = body.warnings?.[0] ?? '';
		} catch (cause) {
			error = requestError(cause);
		} finally {
			busy = false;
		}
	}
</script>

{#if invite}
	<section class="invite" class:canceled={invite.canceled} aria-label="Calendar invitation">
		<div class="date" aria-hidden="true">
			<span>{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
			<strong>{Number(day.slice(8, 10))}</strong>
		</div>
		<div class="body">
			<p class="title">{invite.title}</p>
			<p class="meta">{when}</p>
			{#if invite.repeat}<p class="meta">{invite.repeat}{invite.repeatSimplified ? '' : ''}</p>{:else if invite.repeatSimplified}<p class="meta">Repeats in a way QuickMail can't show; only the first date is added.</p>{/if}
			{#if invite.location}<p class="meta"><Icon name="map-pin-line" size={13} /> {invite.location}</p>{/if}
			{#if invite.organizer && !invite.reply}<p class="meta">From {invite.organizer.name ?? invite.organizer.email}{invite.attendeeCount > 1 ? ` · ${invite.attendeeCount} guests` : ''}</p>{/if}

			{#if invite.canceled}
				<p class="state">This event was canceled{invite.eventId ? '.' : ' and is not in your calendar.'}</p>
			{:else if invite.reply}
				<p class="state">{invite.reply.name ?? invite.reply.email} {REPLY_TEXT[invite.reply.status]}.</p>
			{:else if invite.mine}
				<p class="state">You organize this event.</p>
			{:else if answerable}
				{#if invite.outdated}<p class="hint">A newer version of this invitation has arrived.</p>{/if}
				<div class="actions">
					{#if invite.method === 'PUBLISH'}
						<button type="button" class="answer" class:on={invite.myStatus === 'accepted'} disabled={busy} onclick={() => respond('accepted')}>{invite.myStatus === 'accepted' ? 'In your calendar' : 'Add to calendar'}</button>
					{:else}
						<span class="ask">{invite.myStatus && invite.myStatus !== 'needs-action' ? STATUS_TEXT[invite.myStatus] : 'Going?'}</span>
						{#each [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']] as const as [value, label] (value)}
							<button type="button" class="answer" class:on={invite.myStatus === value} aria-pressed={invite.myStatus === value} disabled={busy} onclick={() => respond(value)}>{label}</button>
						{/each}
					{/if}
					{#if invite.eventId && invite.myStatus !== 'declined'}<a class="open" href={`/calendar?view=day&date=${day}`}>Open in calendar</a>{/if}
				</div>
			{/if}
			{#if notice}<p class="hint">{notice}</p>{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>
	</section>
{:else if !failed}
	<div class="invite loading" aria-hidden="true"></div>
{/if}

<style>
	.invite { display: flex; gap: 0.85rem; margin: 0.75rem 0; padding: 0.85rem 1rem; border-radius: 14px; background: var(--color-surface-muted); border: 1px solid var(--color-line); }
	.invite.loading { height: 5.5rem; opacity: 0.5; }
	.date { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 3.1rem; height: 3.3rem; border-radius: 10px; background: var(--color-surface); box-shadow: var(--mat-cap); line-height: 1.1; }
	.date span { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; color: var(--color-danger); }
	.date strong { font-size: 1.25rem; color: var(--color-text); }
	.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
	.title { font-size: 0.975rem; font-weight: 600; color: var(--color-text); }
	.canceled .title { text-decoration: line-through; }
	.meta { display: flex; align-items: center; gap: 0.25rem; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.state { margin-top: 0.35rem; font-size: 0.8125rem; font-weight: 500; color: var(--color-text); }
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin-top: 0.55rem; }
	.ask { margin-right: 0.25rem; font-size: 0.8125rem; font-weight: 500; color: var(--color-text); }
	.answer { min-height: 2rem; padding: 0 0.9rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 500; color: var(--color-text); background: var(--color-surface); box-shadow: var(--mat-cap); }
	.answer:hover { background: var(--color-surface-hover); }
	.answer.on { color: var(--color-on-accent); background: var(--color-accent); box-shadow: var(--mat-cap-accent); }
	.open { margin-left: auto; font-size: 0.8125rem; font-weight: 500; color: var(--color-accent-text); }
	.open:hover { text-decoration: underline; }
	.hint { margin-top: 0.3rem; font-size: 0.75rem; color: var(--color-muted); }
	.error { margin-top: 0.3rem; font-size: 0.8125rem; color: var(--color-danger); }
	@media (max-width: 640px) {
		.open { margin-left: 0; width: 100%; }
	}
</style>

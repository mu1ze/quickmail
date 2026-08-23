<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import EmptyState from './EmptyState.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import SnoozeMenu from './SnoozeMenu.svelte';
	import HoldToConfirm from '$lib/interior/HoldToConfirm.svelte';
	import { formatRelativeDate } from '$lib/utils/date';
	import { formatSnoozeUntil } from '$lib/snooze';
	import { isGoChordArmed, isTypingTarget } from '$lib/shortcuts';
	import { showUndo } from '$lib/undo';
	import type { MailboxFilters, MailboxPage, MailboxView, ThreadSummary } from '$lib/types';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	const META: Record<MailboxView, { title: string; icon: string; empty: string }> = {
		inbox: { title: 'Inbox', icon: 'inbox-line', empty: 'Your inbox is empty' },
		starred: { title: 'Starred', icon: 'star-line', empty: 'No starred messages' },
		drafts: { title: 'Drafts', icon: 'draft-line', empty: 'No drafts saved' },
		sent: { title: 'Sent', icon: 'send-plane-line', empty: 'Nothing sent yet' },
		later: { title: 'Later', icon: 'time-line', empty: 'Nothing waiting' },
		trash: { title: 'Trash', icon: 'delete-bin-line', empty: 'Trash is empty' }
	};

	const meta = $derived(META[view]);

	// Local copy so stars and reads can flip before the server round trip lands.
	let items = $state<ThreadSummary[]>([]);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let filterOpen = $state(false);
	let moreOpen = $state(false);
	let selectMenuOpen = $state(false);
	let focused = $state(0);
	let snoozeFor = $state<string | null>(null);
	let bulkSnoozeOpen = $state(false);

	$effect(() => {
		items = mailbox.threads;
		selected = [];
		snoozeFor = null;
		bulkSnoozeOpen = false;
		if (focused >= mailbox.threads.length) focused = Math.max(0, mailbox.threads.length - 1);
	});

	const allSelected = $derived(items.length > 0 && selected.length === items.length);
	const someSelected = $derived(selected.length > 0);
	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly].filter(Boolean).length
	);

	/**
	 * Who to show on the card. Sent and Drafts are about where a message went, so
	 * they name the recipient; everywhere else names the people in the thread.
	 */
	function people(thread: ThreadSummary): string {
		if (view === 'drafts' || (view === 'sent' && thread.participants.every((p) => p.self))) {
			return recipientOf(thread) || (view === 'drafts' ? 'No recipient' : 'Unknown');
		}

		return thread.participants.map((participant) => participant.label).join(', ');
	}

	function recipientOf(thread: ThreadSummary): string {
		const [first] = thread.participants;
		return first?.address ? first.address.split('@')[0].replace(/[._-]+/g, ' ') : '';
	}

	function initial(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		return ((external ?? thread.participants[0])?.address[0] ?? '?').toUpperCase();
	}

	/** Cards carry the newest message; opening one opens the whole conversation. */
	function href(thread: ThreadSummary): string {
		return thread.is_draft ? `/compose?draft=${thread.latest_id}` : `/mail/${thread.latest_id}`;
	}

	function toggle(id: string) {
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}

	function selectAll(next: boolean) {
		selected = next ? items.map((thread) => thread.latest_id) : [];
	}

	function selectWhere(predicate: (thread: ThreadSummary) => boolean) {
		selected = items.filter(predicate).map((thread) => thread.latest_id);
		selectMenuOpen = false;
	}

	/** One entry point for every list action, so the UI always refreshes after. */
	async function run(
		action: string,
		ids: string[] = selected,
		extra: Record<string, unknown> = {}
	) {
		if (busy) return;
		busy = true;
		const target = ids;
		try {
			await fetch('/api/mail/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids: target, ...extra })
			});
			selected = [];
			snoozeFor = null;
			bulkSnoozeOpen = false;
			if (action === 'trash') {
				const n = target.length;
				showUndo(n === 1 ? 'Moved to trash' : `${n} moved to trash`, () =>
					revert('restore', target)
				);
			} else if (action === 'snooze') {
				showUndo('Snoozed until later', () => revert('unsnooze', target));
			}
			await invalidateAll();
		} finally {
			busy = false;
			moreOpen = false;
		}
	}

	async function revert(action: string, ids: string[]) {
		await fetch('/api/mail/actions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ids })
		});
		await invalidateAll();
	}

	function focusedIds(): string[] {
		if (selected.length > 0) return selected;
		const thread = items[focused];
		return thread ? [thread.latest_id] : [];
	}

	function onListKeydown(event: KeyboardEvent) {
		if (
			isTypingTarget(event.target) ||
			isGoChordArmed() ||
			document.querySelector('[data-overlay]')
		) {
			return;
		}
		if (items.length === 0) return;

		const key = event.key;
		if (key === 'j' || key === 'l' || key === 'ArrowRight') {
			event.preventDefault();
			moveFocus(1);
			return;
		}
		if (key === 'k' || key === 'h' || key === 'ArrowLeft') {
			event.preventDefault();
			moveFocus(-1);
			return;
		}
		if (key === 'ArrowDown') {
			event.preventDefault();
			moveFocus(CARD_COLUMNS);
			return;
		}
		if (key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(-CARD_COLUMNS);
			return;
		}
		if (key === 'x') {
			event.preventDefault();
			const id = items[focused]?.latest_id;
			if (id) toggle(id);
			return;
		}
		if (key === 'Enter' || key === 'o') {
			event.preventDefault();
			const thread = items[focused];
			if (thread) goto(href(thread));
			return;
		}
		if (key === 'e' || key === '#') {
			event.preventDefault();
			const ids = focusedIds();
			if (view === 'trash') void run('delete', ids);
			else void run('trash', ids);
			return;
		}
		if (key === 's') {
			event.preventDefault();
			const thread = items[focused];
			if (thread) void toggleStar(thread);
			return;
		}
		if (key === 'u') {
			event.preventDefault();
			const thread = items[focused];
			if (thread) void run(thread.is_read ? 'unread' : 'read', focusedIds());
			return;
		}
		if (key === 'b') {
			event.preventDefault();
			const id = items[focused]?.latest_id;
			if (id) snoozeFor = snoozeFor === id ? null : id;
		}
	}

	function snoozeIds(ids: string[], until: string) {
		void run('snooze', ids, { until });
	}

	async function toggleStar(thread: ThreadSummary) {
		const isStarred = !thread.is_starred;
		items = items.map((row) =>
			row.thread_id === thread.thread_id ? { ...row, is_starred: isStarred } : row
		);

		await fetch(`/api/mail/${thread.latest_id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isStarred })
		});
		await invalidateAll();
	}

	/** Builds a URL for this mailbox with some query params changed. */
	function withParams(changes: Record<string, string | number | boolean | null>): string {
		const params = new URLSearchParams($currentPage.url.searchParams);

		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === false || value === '') params.delete(key);
			else params.set(key, String(value));
		}

		// Changing what is listed invalidates the current page number.
		if (!('page' in changes)) params.delete('page');

		const query = params.toString();
		return `${$currentPage.url.pathname}${query ? `?${query}` : ''}`;
	}

	function apply(changes: Record<string, string | number | boolean | null>) {
		filterOpen = false;
		goto(withParams(changes));
	}

	const rangeStart = $derived(
		mailbox.total === 0 ? 0 : (mailbox.page - 1) * mailbox.pageSize + 1
	);
	const rangeEnd = $derived(Math.min(mailbox.page * mailbox.pageSize, mailbox.total));

	const CARD_COLUMNS = 3;

	function moveFocus(delta: number) {
		focused = Math.max(0, Math.min(items.length - 1, focused + delta));
		queueMicrotask(() => {
			document.querySelector<HTMLElement>('.card.focused')?.scrollIntoView({
				block: 'nearest',
				inline: 'nearest'
			});
		});
	}
</script>

<svelte:window onkeydown={onListKeydown} />

<section class="mailbox">
	<header class="toolbar">
		<div class="toolbar-left">
			<div class="select-all">
				<Check
					label="Select all messages"
					checked={allSelected}
					indeterminate={someSelected && !allSelected}
					onchange={selectAll}
				/>
				<button
					type="button"
					class="caret"
					aria-label="Selection options"
					aria-expanded={selectMenuOpen}
					onclick={() => (selectMenuOpen = !selectMenuOpen)}
				>
					<Icon name="arrow-down-s-line" size={14} />
				</button>

				{#if selectMenuOpen}
					<button
						type="button"
						class="backdrop"
						aria-label="Close menu"
						onclick={() => (selectMenuOpen = false)}
					></button>
					<div class="menu menu-left" role="menu">
						<button type="button" class="menu-item" onclick={() => selectWhere(() => true)}>
							All
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere(() => false)}>
							None
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => !e.is_read)}>
							Unread
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_read)}>
							Read
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_starred)}>
							Starred
						</button>
					</div>
				{/if}
			</div>

			{#if someSelected}
				<span class="selected-count">{selected.length} selected</span>

				<div class="bulk-actions">
					<button
						type="button"
						class="tool-btn"
						title="Mark as read"
						disabled={busy}
						onclick={() => run('read')}
					>
						<Icon name="mail-open-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Mark as unread"
						disabled={busy}
						onclick={() => run('unread')}
					>
						<Icon name="mail-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Star"
						disabled={busy}
						onclick={() => run('star')}
					>
						<Icon name="star-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Remove star"
						disabled={busy}
						onclick={() => run('unstar')}
					>
						<Icon name="star-off-line" size={16} />
					</button>

					{#if view === 'trash'}
						<button
							type="button"
							class="tool-btn"
							title="Restore"
							disabled={busy}
							onclick={() => run('restore')}
						>
							<Icon name="arrow-go-back-line" size={16} />
						</button>
						<button
							type="button"
							class="tool-btn danger"
							title="Delete permanently"
							disabled={busy}
							onclick={() => run('delete')}
						>
							<Icon name="delete-bin-2-line" size={16} />
						</button>
					{:else}
						<div class="snooze-wrap">
							<button
								type="button"
								class="tool-btn"
								title="Snooze (b)"
								disabled={busy}
								onclick={() => (bulkSnoozeOpen = !bulkSnoozeOpen)}
							>
								<Icon name="time-line" size={16} />
							</button>
							{#if bulkSnoozeOpen}
								<button
									type="button"
									class="backdrop"
									aria-label="Close snooze"
									onclick={() => (bulkSnoozeOpen = false)}
								></button>
								<SnoozeMenu
									onPick={(until) => snoozeIds(selected, until)}
									onClose={() => (bulkSnoozeOpen = false)}
								/>
							{/if}
						</div>
						<button
							type="button"
							class="tool-btn"
							title="Move to trash (e)"
							disabled={busy}
							onclick={() => run('trash')}
						>
							<Icon name="delete-bin-line" size={16} />
						</button>
					{/if}
				</div>
			{:else}
				<h1 class="title">{meta.title}</h1>
				{#if mailbox.total > 0}
					<span class="total">{mailbox.total}</span>
				{/if}

				<div class="more">
					<button
						type="button"
						class="tool-btn"
						aria-label="Mailbox actions"
						aria-expanded={moreOpen}
						onclick={() => (moreOpen = !moreOpen)}
					>
						<Icon name="more-line" size={16} />
					</button>

					{#if moreOpen}
						<button
							type="button"
							class="backdrop"
							aria-label="Close menu"
							onclick={() => (moreOpen = false)}
						></button>
						<div class="menu menu-left" role="menu">
							<button type="button" class="menu-item" onclick={() => run('read-all', [])}>
								<Icon name="mail-open-line" size={15} /> Mark all as read
							</button>
							<button type="button" class="menu-item" onclick={() => invalidateAll()}>
								<Icon name="refresh-line" size={15} /> Refresh
							</button>
							{#if view === 'trash'}
								<div class="menu-hold">
									<HoldToConfirm
										label="Empty trash"
										holdLabel="Keep holding"
										confirmLabel="Emptied"
										onConfirm={() => run('empty-trash', [])}
									/>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="toolbar-right">
			<button
				type="button"
				class="pill"
				class:pill-on={filters.unreadOnly}
				onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
			>
				Unread
			</button>

			<div class="filter">
				<button
					type="button"
					class="pill"
					class:pill-on={activeFilterCount > 0}
					aria-expanded={filterOpen}
					onclick={() => (filterOpen = !filterOpen)}
				>
					<Icon name="equalizer-line" size={14} />
					Filter
					{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
				</button>

				{#if filterOpen}
					<button
						type="button"
						class="backdrop"
						aria-label="Close filters"
						onclick={() => (filterOpen = false)}
					></button>
					<div class="menu menu-right" role="menu">
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
						>
							<Icon
								name={filters.unreadOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							Unread only
						</button>
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}
						>
							<Icon
								name={filters.starredOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							Starred only
						</button>
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}
						>
							<Icon
								name={filters.attachmentsOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							Has attachments
						</button>
						{#if activeFilterCount > 0 || filters.q}
							<button
								type="button"
								class="menu-item"
								onclick={() =>
									apply({ unread: null, starred: null, attachments: null, q: null })}
							>
								<Icon name="close-circle-line" size={15} /> Clear all
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="pager">
				<a
					class="pager-btn"
					class:disabled={mailbox.page <= 1}
					href={withParams({ page: mailbox.page - 1 })}
					aria-label="Previous page"
				>
					<Icon name="arrow-left-s-line" size={16} />
				</a>
				<span class="pager-label">{mailbox.page}/{mailbox.pageCount}</span>
				<a
					class="pager-btn"
					class:disabled={mailbox.page >= mailbox.pageCount}
					href={withParams({ page: mailbox.page + 1 })}
					aria-label="Next page"
				>
					<Icon name="arrow-right-s-line" size={16} />
				</a>
			</div>
		</div>
	</header>

	{#if filters.q}
		<div class="search-note">
			<Icon name="search-line" size={14} />
			<span>{mailbox.total} result{mailbox.total === 1 ? '' : 's'} for “{filters.q}”</span>
			<a href={withParams({ q: null })} class="search-clear">Clear</a>
		</div>
	{/if}

	<div class="list">
		{#if items.length === 0}
			<EmptyState
				icon={filters.q ? 'search-line' : meta.icon}
				title={filters.q ? 'No messages match that search' : meta.empty}
			/>
		{:else}
			<ul class="cards">
				{#each items as thread, index (thread.thread_id)}
					<li
						class="card"
						class:unread={!thread.is_read}
						class:checked={selected.includes(thread.latest_id)}
						class:focused={index === focused}
					>
						<div class="card-bar">
							<Check
								label={`Select conversation with ${people(thread)}`}
								checked={selected.includes(thread.latest_id)}
								onchange={() => toggle(thread.latest_id)}
							/>

							<button
								type="button"
								class="star"
								class:on={thread.is_starred}
								aria-label={thread.is_starred ? 'Remove star' : 'Add star'}
								onclick={() => toggleStar(thread)}
							>
								<Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={14} />
							</button>
						</div>

						<a class="card-link" href={href(thread)}>
							<span class="card-who">
								<span class="avatar">{initial(thread)}</span>
								<span class="sender" title={people(thread)}>
									<span class="sender-names">{people(thread)}</span>
									{#if thread.message_count > 1}
										<span class="count">{thread.message_count}</span>
									{/if}
									{#if thread.is_draft}<span class="tag tag-draft">Draft</span>{/if}
								</span>
							</span>

							<span class="subject">{thread.subject || '(no subject)'}</span>
							<span class="preview">
								{thread.preview || 'No preview'}
							</span>

							<span class="card-meta">
								<span class="indicators">
									{#if view === 'sent' && thread.status}
										<DeliveryStatus status={thread.status} />
									{/if}
									{#if view === 'later' && thread.snoozed_until}
										<Icon name="time-line" size={13} />
									{/if}
									{#if thread.has_attachments}
										<Icon name="attachment-2" size={13} />
									{/if}
								</span>
								<span class="date">
									{view === 'later' && thread.snoozed_until
										? formatSnoozeUntil(thread.snoozed_until)
										: formatRelativeDate(thread.created_at)}
								</span>
							</span>
						</a>

						<span class="card-actions">
							{#if view === 'trash'}
								<button
									type="button"
									class="tool-btn"
									title="Restore"
									onclick={() => run('restore', [thread.latest_id])}
								>
									<Icon name="arrow-go-back-line" size={15} />
								</button>
								<button
									type="button"
									class="tool-btn danger"
									title="Delete permanently"
									onclick={() => run('delete', [thread.latest_id])}
								>
									<Icon name="delete-bin-2-line" size={15} />
								</button>
							{:else if view === 'later'}
								<button
									type="button"
									class="tool-btn"
									title="Move to inbox"
									onclick={() => run('unsnooze', [thread.latest_id])}
								>
									<Icon name="inbox-line" size={15} />
								</button>
								<button
									type="button"
									class="tool-btn"
									title="Move to trash"
									onclick={() => run('trash', [thread.latest_id])}
								>
									<Icon name="delete-bin-line" size={15} />
								</button>
							{:else}
								<button
									type="button"
									class="tool-btn"
									title={thread.is_read ? 'Mark as unread' : 'Mark as read'}
									onclick={() => run(thread.is_read ? 'unread' : 'read', [thread.latest_id])}
								>
									<Icon name={thread.is_read ? 'mail-line' : 'mail-open-line'} size={15} />
								</button>
								<div class="snooze-wrap">
									<button
										type="button"
										class="tool-btn"
										title="Snooze (b)"
										onclick={() =>
											(snoozeFor = snoozeFor === thread.latest_id ? null : thread.latest_id)}
									>
										<Icon name="time-line" size={15} />
									</button>
									{#if snoozeFor === thread.latest_id}
										<button
											type="button"
											class="backdrop"
											aria-label="Close snooze"
											onclick={() => (snoozeFor = null)}
										></button>
										<SnoozeMenu
											onPick={(until) => snoozeIds([thread.latest_id], until)}
											onClose={() => (snoozeFor = null)}
										/>
									{/if}
								</div>
								<button
									type="button"
									class="tool-btn"
									title="Move to trash (e)"
									onclick={() => run('trash', [thread.latest_id])}
								>
									<Icon name="delete-bin-line" size={15} />
								</button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if mailbox.total > 0}
		<footer class="list-foot">
			<span>{rangeStart}–{rangeEnd} of {mailbox.total}</span>
		</footer>
	{/if}
</section>

<style>
	.mailbox {
		display: flex;
		flex-direction: column;
		background: transparent;
	}

	/* --- toolbar --- */

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.toolbar-left,
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.title {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.total {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.selected-count {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		margin-left: 0.25rem;
	}

	.select-all {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding-right: 0.25rem;
	}

	.caret {
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}

	.caret:hover {
		color: var(--color-text);
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 9px;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.tool-btn:disabled {
		opacity: 0.4;
	}

	.tool-btn.danger:hover {
		color: var(--color-danger);
	}

	.more,
	.filter {
		position: relative;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.875rem;
		padding: 0 0.6875rem;
		border-radius: 9px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
		background: var(--color-well);
		box-shadow: var(--mat-well);
		transition: background 0.15s, color 0.15s, box-shadow 0.15s;
	}

	.pill:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.pill-on {
		color: var(--color-text);
		font-weight: 500;
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}

	.filter-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.25rem;
		border-radius: 6px;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.pager-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9px;
		color: var(--color-text-secondary);
		transition: background 0.15s;
	}

	.pager-btn:hover {
		background: var(--color-surface-muted);
	}

	.pager-btn.disabled {
		pointer-events: none;
		color: var(--color-muted);
		opacity: 0.4;
	}

	.pager-label {
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	/* --- dropdown menus --- */

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		z-index: 30;
		min-width: 11rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 14px;
		box-shadow: var(--mat-float);
	}

	.menu-left {
		left: 0;
	}

	.menu-right {
		right: 0;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
		transition: background 0.12s, color 0.12s;
	}

	.menu-item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.menu-item.danger:hover {
		color: var(--color-danger);
	}

	.menu-hold {
		padding: 0.25rem;
	}

	.menu-hold :global(.hold) {
		width: 100%;
	}

	/* --- search note --- */

	.search-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.search-clear {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-muted);
		text-decoration: underline;
	}

	.search-clear:hover {
		color: var(--color-text);
	}

	/* --- cards --- */

	.list {
		padding: 0.75rem 0.25rem 0.5rem;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		height: 100%;
		padding: 0.5rem 0.55rem 0.55rem;
		border-radius: 14px;
		background: var(--color-well);
		box-shadow: var(--mat-well);
		transition: background 0.12s, box-shadow 0.12s;
	}

	.card.unread {
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}

	.card:hover,
	.card.unread:hover {
		background: var(--color-surface-muted);
	}

	.card.checked,
	.card.checked:hover {
		background: var(--color-accent-soft);
		box-shadow: none;
	}

	.card.focused:not(.checked) {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.card:has(.backdrop) {
		z-index: 6;
	}

	.card-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.125rem;
		margin: -0.125rem -0.125rem 0.25rem;
	}

	.snooze-wrap {
		position: relative;
	}

	.star {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-muted);
		transition: color 0.12s;
	}

	.star:hover {
		color: var(--color-text);
	}

	.star.on {
		color: var(--color-star);
	}

	.card-link {
		display: flex;
		flex-direction: column;
		flex: 1;
		gap: 0.25rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.card-who {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 8px;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.card.unread .avatar {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.sender {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: capitalize;
	}

	.card.unread .sender {
		font-weight: 600;
		color: var(--color-text);
	}

	.sender-names {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* How many messages the conversation holds. */
	.count {
		flex-shrink: 0;
		font-size: 0.6875rem;
		font-weight: 400;
		color: var(--color-muted);
	}

	.card.unread .count {
		color: var(--color-text-secondary);
	}

	.subject {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		font-size: 0.8125rem;
		line-height: 1.3;
		color: var(--color-text-secondary);
		word-break: break-word;
	}

	.card.unread .subject {
		font-weight: 600;
		color: var(--color-text);
	}

	.preview {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--color-muted);
		word-break: break-word;
	}

	.card-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
		margin-top: 0.25rem;
		min-width: 0;
	}

	.indicators {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		color: var(--color-muted);
	}

	.tag {
		padding: 0.0625rem 0.3125rem;
		border-radius: 5px;
		font-size: 0.5625rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-surface-hover);
		white-space: nowrap;
	}

	.tag-draft {
		color: var(--color-danger);
		background: rgba(185, 28, 28, 0.08);
	}

	.date {
		font-size: 0.6875rem;
		color: var(--color-muted);
		text-align: right;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card.unread .date {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.card-actions {
		position: absolute;
		right: 0.4rem;
		bottom: 0.4rem;
		z-index: 5;
		display: none;
		align-items: center;
		gap: 0.125rem;
		padding: 0.2rem 0.2rem 0.2rem 1.25rem;
		border-radius: 10px;
		background: linear-gradient(to right, transparent, var(--color-surface-muted) 1.1rem);
	}

	.card:hover .card-actions {
		display: flex;
	}

	.list-foot {
		display: flex;
		justify-content: flex-end;
		padding: 0.5rem 0.25rem 0.25rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	@media (max-width: 900px) {
		.toolbar {
			flex-wrap: wrap;
			row-gap: 0.5rem;
			padding: 0.5rem 0.25rem;
		}

		.toolbar-left,
		.toolbar-right {
			width: 100%;
			justify-content: space-between;
		}

		.toolbar-right {
			padding-bottom: 0.125rem;
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		.title {
			font-size: 1rem;
		}

		.tool-btn,
		.pager-btn,
		.caret {
			width: 2.75rem;
			height: 2.75rem;
			min-width: 2.75rem;
		}

		.pill {
			height: 2.5rem;
			padding: 0 0.875rem;
		}

		.bulk-actions {
			flex-wrap: wrap;
		}

		.list {
			padding: 0.5rem 0 0;
		}

		.cards {
			gap: 0.375rem;
		}

		.card {
			padding: 0.375rem 0.4rem 0.45rem;
			border-radius: 12px;
		}

		.card-bar {
			margin: -0.1rem -0.05rem 0.2rem;
		}

		.star {
			width: 1.375rem;
			height: 1.375rem;
		}

		.card-who {
			gap: 0.25rem;
		}

		.avatar {
			width: 1.25rem;
			height: 1.25rem;
			border-radius: 6px;
			font-size: 0.5rem;
		}

		.sender {
			font-size: 0.6875rem;
		}

		.subject {
			font-size: 0.75rem;
		}

		.preview {
			font-size: 0.6875rem;
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}

		.date {
			font-size: 0.625rem;
		}

		.card :global(.check) {
			width: 1.375rem;
			height: 1.375rem;
		}

		.indicators :global(.status) {
			padding: 0.0625rem;
			gap: 0;
		}

		.indicators :global(.label) {
			display: none;
		}

		.card-actions {
			display: none !important;
		}
	}
</style>

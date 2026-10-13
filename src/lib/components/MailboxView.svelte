<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import EmptyState from './EmptyState.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import SnoozeMenu from './SnoozeMenu.svelte';
	import AdvancedSearch from './AdvancedSearch.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import HoldToConfirm from '$lib/interior/HoldToConfirm.svelte';
	import { formatRelativeDate } from '$lib/utils/date';
	import { formatSnoozeUntil } from '$lib/snooze';
	import { isGoChordArmed, isTypingTarget } from '$lib/shortcuts';
	import { showUndo } from '$lib/undo';
	import { getShellContext } from '$lib/shell-context';
	import { onSearchFocus } from '$lib/search-focus';
	import { handleMailboxRowClick, toggleSelection } from '$lib/mailbox-select';
	import { threadHeadline } from '$lib/mailbox-people';
	import { requireOk, requestError } from '$lib/utils/request';
	import {
		readMailboxLayout,
		setMailboxLayout,
		watchMailboxLayout,
		type MailboxLayout
	} from '$lib/mailbox-layout';
	import type { MailboxCounts, MailboxFilters, MailboxPage, MailboxView, ThreadSummary, MailLabel } from '$lib/types';

	const shell = getShellContext();

	const AVATAR_PALETTE = [
		{ bg: '#8b5cf6', fg: '#ffffff' },
		{ bg: '#eab308', fg: '#1c1917' },
		{ bg: '#0a66c2', fg: '#ffffff' },
		{ bg: '#ec4899', fg: '#ffffff' },
		{ bg: '#14b8a6', fg: '#ffffff' },
		{ bg: '#f97316', fg: '#ffffff' }
	];

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
		later: { title: 'Snoozed', icon: 'time-line', empty: 'Nothing waiting' },
		trash: { title: 'Trash', icon: 'delete-bin-line', empty: 'Trash is empty' },
		all: { title: 'All mail', icon: 'mail-line', empty: 'No conversations yet' },
		spam: { title: 'Spam', icon: 'spam-2-line', empty: 'No spam here' }
	};

	const meta = $derived(META[view]);

	// Local copy so stars and reads can flip before the server round trip lands.
	let items = $state<ThreadSummary[]>([]);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let actionError = $state('');
	let moreOpen = $state(false);
	let selectMenuOpen = $state(false);
	let focused = $state(0);
	let snoozeFor = $state<string | null>(null);
	let rowMenuFor = $state<string | null>(null);
	let bulkSnoozeOpen = $state(false);
	let layout = $state<MailboxLayout>('list');
	let selectMode = $state(false);
	let searchOpen = $state(false);
	let advancedOpen = $state(false);
	let selectionAnchor = $state<string | null>(null);
	let searchQuery = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);

	const counts = $derived(($currentPage.data.counts ?? {}) as MailboxCounts);
	const labels = $derived(($currentPage.data.labels ?? []) as MailLabel[]);
	const activeLabel = $derived(labels.find((label) => label.id === filters.labelId));

	$effect(() => {
		return onSearchFocus(() => {
			searchOpen = true;
			queueMicrotask(() => searchInput?.focus());
		});
	});

	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly].filter(Boolean).length
	);

	const subtitle = $derived.by(() => {
		const parts: string[] = [];
		if (activeFilterCount > 0 || filters.unreadOnly) {
			if (filters.unreadOnly) parts.push('Unread');
			if (filters.starredOnly) parts.push('Starred');
			if (filters.attachmentsOnly) parts.push('Attachments');
		} else {
			parts.push('All Mail');
		}
		if (view === 'inbox' && counts.drafts > 0) {
			parts.push(`${counts.drafts} Unsent Message${counts.drafts === 1 ? '' : 's'}`);
		} else if (mailbox.total > 0) {
			parts.push(`${mailbox.total} message${mailbox.total === 1 ? '' : 's'}`);
		}
		return parts.join(' · ');
	});

	$effect(() => {
		searchQuery = filters.q ?? '';
	});

	$effect(() => {
		layout = readMailboxLayout();
		return watchMailboxLayout((next) => {
			layout = next;
		});
	});

	$effect(() => {
		items = mailbox.threads;
		selected = untrack(() => selected.filter((id) => mailbox.threads.some((row) => row.latest_id === id)));
		snoozeFor = null;
		rowMenuFor = null;
		bulkSnoozeOpen = false;
		focused = untrack(() => Math.max(0, Math.min(focused, mailbox.threads.length - 1)));
	});

	const allSelected = $derived(items.length > 0 && selected.length === items.length);
	const someSelected = $derived(selected.length > 0);

	/**
	 * Who to show on the card. Sent and Drafts are about where a message went;
	 * everywhere else names the senders. Always the email, not a guessed name.
	 */
	function people(thread: ThreadSummary): string {
		return threadHeadline(thread, view);
	}

	function initial(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		return ((external ?? thread.participants[0])?.address[0] ?? '?').toUpperCase();
	}

	function avatarSeed(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		return (external ?? thread.participants[0])?.address ?? thread.thread_id;
	}

	function avatarStyle(thread: ThreadSummary): string {
		const seed = avatarSeed(thread);
		let hash = 0;
		for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
		const color = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
		return `--avatar-bg:${color.bg};--avatar-fg:${color.fg}`;
	}

	function toggleSelectMode() {
		moreOpen = false;
		rowMenuFor = null;
		if (selectMode) {
			selectMode = false;
			selected = [];
		} else {
			selectMode = true;
		}
	}

	function toggleRowMenu(id: string) {
		snoozeFor = null;
		rowMenuFor = rowMenuFor === id ? null : id;
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		searchOpen = false;
		void goto(`/all${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ''}`);
	}

	function clearSearch() {
		searchQuery = '';
		searchOpen = false;
		if (filters.q) apply({ q: null });
	}

	/** Cards carry the newest message; opening one opens the whole conversation. */
	function href(thread: ThreadSummary): string {
		const returnTo = encodeURIComponent($currentPage.url.pathname + $currentPage.url.search);
		return thread.is_draft ? `/compose?draft=${thread.latest_id}` : `/mail/${thread.latest_id}?return=${returnTo}`;
	}

	function toggle(id: string, event?: MouseEvent) {
		const anchorIndex = items.findIndex((row) => row.latest_id === selectionAnchor);
		const index = items.findIndex((row) => row.latest_id === id);
		if (event?.shiftKey && anchorIndex >= 0 && index >= 0) {
			const range = items.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).map((row) => row.latest_id);
			selected = selected.includes(id) ? selected.filter((value) => !range.includes(value)) : [...new Set([...selected, ...range])];
		} else selected = toggleSelection(selected, id);
		selectionAnchor = id;
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
		if (busy) return false;
		busy = true;
		actionError = '';
		const target = ids;
		const unarchived = items.filter((row) => target.includes(row.latest_id) && !row.is_archived).map((row) => row.latest_id);
		try {
			const response = await fetch('/api/mail/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids: target, ...extra })
			});
			await requireOk(response);
			selected = [];
			snoozeFor = null;
			rowMenuFor = null;
			bulkSnoozeOpen = false;
			moreOpen = false;
			if (action === 'trash') {
				const n = target.length;
				showUndo(n === 1 ? 'Moved to trash' : `${n} moved to trash`, () =>
					revert('restore', target)
				);
			} else if (action === 'archive') {
				showUndo(target.length === 1 ? 'Conversation archived' : `${target.length} conversations archived`, unarchived.length ? () => revert('unarchive', unarchived) : undefined);
			} else if (action === 'spam') {
				showUndo('Moved to spam', () => revert('not-spam', target));
			} else if (action === 'snooze') {
				showUndo('Snoozed until later', () => revert('unsnooze', target));
			}
			await invalidateAll();
			return true;
		} catch (cause) {
			actionError = requestError(cause);
			return false;
		} finally {
			busy = false;
			moreOpen = false;
		}
	}

	async function revert(action: string, ids: string[]) {
		const response = await fetch('/api/mail/actions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ids })
		});
		await requireOk(response);
		await invalidateAll();
	}

	function focusedIds(): string[] {
		if (selected.length > 0) return selected;
		const thread = items[focused];
		return thread ? [thread.latest_id] : [];
	}

	function onListKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') { moreOpen = false; selectMenuOpen = false; rowMenuFor = null; snoozeFor = null; bulkSnoozeOpen = false; selected = []; selectMode = false; return; }
		if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
		if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button, a:not(.card-link)')) return;
		if (
			isTypingTarget(event.target) ||
			isGoChordArmed() ||
			document.querySelector('[data-overlay], dialog[open]')
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
			moveFocus(layout === 'list' ? 1 : cardColumns());
			return;
		}
		if (key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(layout === 'list' ? -1 : -cardColumns());
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
		if (key === 'e' && view !== 'trash' && view !== 'drafts' && view !== 'spam') {
			event.preventDefault(); void run('archive', focusedIds()); return;
		}
		if (key === '#') {
			event.preventDefault();
			const ids = focusedIds();
			if (view === 'trash') actionError = 'Use Delete permanently in the actions menu to delete a conversation.';
			else void run('trash', ids);
			return;
		}
		if (key === 's') {
			event.preventDefault();
			const thread = items[focused];
			if (thread) void toggleStar(thread);
			return;
		}
		if (key === 'p') {
			event.preventDefault();
			const thread = items[focused];
			if (thread) void togglePin(thread);
			return;
		}
		if (key === 'f') {
			event.preventDefault();
			const thread = items[focused];
			if (thread && !thread.is_draft) goto(`/compose?forward=${thread.latest_id}`);
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
		if (busy) return;
		busy = true;
		actionError = '';
		const isStarred = !thread.is_starred;
		rowMenuFor = null;
		items = items.map((row) =>
			row.thread_id === thread.thread_id ? { ...row, is_starred: isStarred } : row
		);

		try {
			const response = await fetch(`/api/mail/${thread.latest_id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isStarred })
			});
			await requireOk(response);
			await invalidateAll();
		} catch (cause) {
			items = items.map((row) => row.thread_id === thread.thread_id ? { ...row, is_starred: thread.is_starred } : row);
			actionError = requestError(cause);
		} finally { busy = false; }
	}

	async function togglePin(thread: ThreadSummary) {
		if (busy) return;
		busy = true;
		actionError = '';
		const isPinned = !thread.is_pinned;
		rowMenuFor = null;
		items = items.map((row) =>
			row.thread_id === thread.thread_id ? { ...row, is_pinned: isPinned } : row
		);

		try {
			const response = await fetch(`/api/mail/${thread.latest_id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isPinned })
			});
			await requireOk(response);
			await invalidateAll();
		} catch (cause) {
			items = items.map((row) => row.thread_id === thread.thread_id ? { ...row, is_pinned: thread.is_pinned } : row);
			actionError = requestError(cause);
		} finally { busy = false; }
	}

	async function refresh() {
		if (busy) return;
		busy = true; actionError = ''; moreOpen = false;
		try { await invalidateAll(); } catch (cause) { actionError = requestError(cause); } finally { busy = false; }
	}

	function chooseLayout(next: MailboxLayout) {
		layout = next;
		setMailboxLayout(next);
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
		goto(withParams(changes));
	}

	const rangeStart = $derived(
		mailbox.total === 0 ? 0 : (mailbox.page - 1) * mailbox.pageSize + 1
	);
	const rangeEnd = $derived(Math.min(mailbox.page * mailbox.pageSize, mailbox.total));

	/** Match keyboard movement to the columns actually displayed. */
	function cardColumns(): number {
		if (typeof window === 'undefined') return 3;
		const grid = document.querySelector('.cards');
		if (!grid) return 1;
		const columns = getComputedStyle(grid).gridTemplateColumns;
		return columns === 'none' ? 1 : columns.split(' ').length;
	}

	function moveFocus(delta: number) {
		focused = Math.max(0, Math.min(items.length - 1, focused + delta));
		queueMicrotask(() => {
			const card = document.querySelector<HTMLElement>('.card.focused');
			card?.querySelector<HTMLAnchorElement>('.card-link')?.focus({ preventScroll: true });
			card?.scrollIntoView({
				block: 'nearest',
				inline: 'nearest'
			});
		});
	}
</script>

<svelte:window onkeydown={onListKeydown} />
<AdvancedSearch bind:open={advancedOpen} query={filters.q} onSearch={(query) => { searchOpen = false; void goto(`/all${query ? `?q=${encodeURIComponent(query)}` : ''}`); }} />

<section class="mailbox">
	{#if actionError}
		<div class="action-error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss error" onclick={() => (actionError = '')}><Icon name="close-line" size={18} /></button></div>
	{/if}
	<header class="ios-header">
		<button type="button" class="ios-back" aria-label="Open menu" onclick={() => shell?.openNav()}>
			<Icon name="arrow-left-s-line" size={22} />
		</button>

		<div class="ios-title-block">
			<h1 class="ios-title">{activeLabel?.name ?? meta.title}</h1>
			<p class="ios-subtitle">{subtitle}</p>
		</div>

		<div class="ios-actions">
			{#if selectMode}
				<button type="button" class="ios-select" onclick={toggleSelectMode}>Cancel</button>
			{/if}

			<div class="ios-more">
				<button
					type="button"
					class="ios-icon-btn"
					aria-label="Mailbox actions"
					aria-expanded={moreOpen}
					onclick={() => (moreOpen = !moreOpen)}
				>
					<Icon name="more-2-fill" size={18} />
				</button>

				{#if moreOpen}
					<button
						type="button"
						class="backdrop"
						aria-label="Close menu"
						onclick={() => (moreOpen = false)}
					></button>
					<div class="menu menu-right" role="menu">
						<button type="button" class="menu-item" onclick={() => { moreOpen = false; advancedOpen = true; }}><Icon name="search-line" size={16} />Search options</button>
						<button type="button" class="menu-item" onclick={toggleSelectMode}>
							<Icon name="checkbox-line" size={15} />
							{selectMode ? 'Cancel selection' : 'Select'}
						</button>
						<button type="button" class="menu-item" onclick={() => run('read-all', [])}>
							<Icon name="mail-open-line" size={15} /> Mark all as read
						</button>
						<button type="button" class="menu-item" onclick={refresh}>
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
		</div>
	</header>

	{#if selectMode && someSelected}
		<div class="ios-bulk-bar">
			<span class="ios-bulk-count">{selected.length} selected</span>
			<div class="ios-bulk-actions">
				<LabelPicker {labels} ids={selected} existing={items.filter((row) => selected.includes(row.latest_id)).map((row) => row.labels ?? [])} disabled={busy} />
				{#if view !== 'trash' && view !== 'spam' && view !== 'drafts'}<button type="button" class="ios-icon-btn" aria-label="Archive selected" disabled={busy} onclick={() => run('archive')}><Icon name="archive-line" size={18} /></button>{/if}
				{#if view === 'spam' || view === 'all' || view === 'trash' || view === 'later'}<button type="button" class="ios-icon-btn" aria-label="Move selected to inbox" disabled={busy} onclick={() => run('inbox')}><Icon name="inbox-line" size={18} /></button>{/if}
				<button type="button" class="ios-icon-btn" title="Mark as read" disabled={busy} onclick={() => run('read')}>
					<Icon name="mail-open-line" size={18} />
				</button>
				<button type="button" class="ios-icon-btn" title="Add star" disabled={busy} onclick={() => run('star')}>
					<Icon name="star-line" size={18} />
				</button>
				<button type="button" class="ios-icon-btn" title="Move to trash" disabled={busy} onclick={() => run('trash')}>
					<Icon name="delete-bin-line" size={18} />
				</button>
			</div>
		</div>
	{/if}

	<div class="ios-filters">
		<div class="ios-filter-icons">
			<button
				type="button"
				class="ios-filter-icon"
				class:active={filters.unreadOnly}
				aria-label="Unread"
				aria-pressed={filters.unreadOnly}
				onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
			>
				<Icon name="mail-unread-line" size={18} />
			</button>
			<button
				type="button"
				class="ios-filter-icon"
				class:active={filters.starredOnly}
				aria-label="Starred"
				aria-pressed={filters.starredOnly}
				onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}
			>
				<Icon name="star-line" size={18} />
			</button>
			<button
				type="button"
				class="ios-filter-icon"
				class:active={filters.attachmentsOnly}
				aria-label="Has attachments"
				aria-pressed={filters.attachmentsOnly}
				onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}
			>
				<Icon name="attachment-2" size={18} />
			</button>
			<a class="ios-filter-icon" aria-label="Later" href="/later">
				<Icon name="time-line" size={18} />
			</a>
		</div>
		<button
			type="button"
			class="ios-filter-pill"
			class:active={activeFilterCount === 0 && !filters.q}
			onclick={() => apply({ unread: null, starred: null, attachments: null, q: null })}
		>
			<Icon name="mail-line" size={16} />
			All messages
		</button>
	</div>

	{#if searchOpen || filters.q}
		<form class="ios-search" role="search" onsubmit={submitSearch}>
			<Icon name="search-line" size={16} />
			<input
				type="search"
				bind:this={searchInput}
				bind:value={searchQuery}
				placeholder="Search"
				aria-label="Search messages"
				enterkeyhint="search"
			/>
			<button type="button" class="ios-search-close" aria-label="Show search options" onclick={() => (advancedOpen = true)}><Icon name="equalizer-line" size={18} /></button>
			<button type="button" class="ios-search-close" aria-label="Close search" onclick={clearSearch}>
				<Icon name="close-line" size={16} />
			</button>
		</form>
	{/if}

	<div class="mailbox-heading">
		<div><p class="eyebrow">YOUR MAILBOX</p><h1>{filters.q ? 'Search results' : activeLabel?.name ?? meta.title}<span>{mailbox.total} conversation{mailbox.total === 1 ? '' : 's'}</span></h1></div>
		<a href="/compose" class="heading-compose"><Icon name="add-line" size={16} />New message</a>
	</div>
	<header class="toolbar" aria-label="Mailbox tools" aria-busy={busy}>
		<div class="toolbar-left">
			<div class="select-all">
				<Check label="Select all messages" checked={allSelected} indeterminate={someSelected && !allSelected} disabled={busy} onchange={selectAll} />
				<button type="button" class="caret" aria-label="Selection options" aria-expanded={selectMenuOpen} onclick={() => (selectMenuOpen = !selectMenuOpen)}><Icon name="arrow-down-s-line" size={16} /></button>
				{#if selectMenuOpen}
					<button type="button" class="backdrop" aria-label="Close selection options" onclick={() => (selectMenuOpen = false)}></button>
					<div class="menu menu-left">
						<button type="button" class="menu-item" onclick={() => selectWhere(() => true)}>All on this page</button>
						<button type="button" class="menu-item" onclick={() => selectWhere(() => false)}>None</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((row) => !row.is_read)}>Unread</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((row) => row.is_read)}>Read</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((row) => row.is_starred)}>Starred</button>
					</div>
				{/if}
			</div>
			{#if someSelected}
				<div class="bulk-actions">
					{#if view === 'trash' || view === 'spam' || view === 'all' || view === 'later'}
						<button type="button" class="tool-btn" title="Move to inbox" aria-label="Move to inbox" disabled={busy} onclick={() => run('inbox')}><Icon name="inbox-line" size={19} /></button>
					{/if}
					{#if view !== 'trash' && view !== 'spam' && view !== 'drafts'}
						<button type="button" class="tool-btn" title="Archive (e)" aria-label="Archive" disabled={busy} onclick={() => run('archive')}><Icon name="archive-line" size={19} /></button>
					{/if}
					{#if view !== 'drafts' && view !== 'trash'}
						<button type="button" class="tool-btn" title={view === 'spam' ? 'Not spam' : 'Mark as spam'} aria-label={view === 'spam' ? 'Not spam' : 'Mark as spam'} disabled={busy} onclick={() => run(view === 'spam' ? 'not-spam' : 'spam')}><Icon name={view === 'spam' ? 'shield-check-line' : 'spam-2-line'} size={19} /></button>
					{/if}
					<button type="button" class="tool-btn" title={view === 'trash' ? 'Delete permanently' : 'Move to trash (#)'} aria-label={view === 'trash' ? 'Delete permanently' : 'Move to trash'} disabled={busy} onclick={() => run(view === 'trash' ? 'delete' : 'trash')}><Icon name="delete-bin-line" size={19} /></button>
					<span class="tool-divider"></span>
					<LabelPicker {labels} ids={selected} existing={items.filter((row) => selected.includes(row.latest_id)).map((row) => row.labels ?? [])} disabled={busy} />
					<button type="button" class="tool-btn" title="Mark as read" aria-label="Mark as read" disabled={busy} onclick={() => run('read')}><Icon name="mail-open-line" size={19} /></button>
					<button type="button" class="tool-btn" title="Mark as unread" aria-label="Mark as unread" disabled={busy} onclick={() => run('unread')}><Icon name="mail-unread-line" size={19} /></button>
					{#if view !== 'trash' && view !== 'spam' && view !== 'drafts'}
						<div class="snooze-wrap">
							<button type="button" class="tool-btn" title="Snooze (b)" aria-label="Snooze" disabled={busy} onclick={() => (bulkSnoozeOpen = !bulkSnoozeOpen)}><Icon name="time-line" size={19} /></button>
							{#if bulkSnoozeOpen}
								<button type="button" class="backdrop" aria-label="Close snooze" onclick={() => (bulkSnoozeOpen = false)}></button>
								<SnoozeMenu onPick={(until) => snoozeIds(selected, until)} onClose={() => (bulkSnoozeOpen = false)} />
							{/if}
						</div>
					{/if}
				</div>
				<span class="selected-count" aria-live="polite">{selected.length} selected</span>
			{:else}
				<button type="button" class="tool-btn" title="Refresh" aria-label="Refresh" disabled={busy} onclick={refresh}><Icon name="refresh-line" size={19} /></button>
			{/if}
			<div class="more">
				<button type="button" class="tool-btn" title="More actions" aria-label="More actions" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}><Icon name="more-2-fill" size={19} /></button>
				{#if moreOpen}
					<button type="button" class="backdrop" aria-label="Close menu" onclick={() => (moreOpen = false)}></button>
					<div class="menu menu-left">
						{#if someSelected}
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('star')}><Icon name="star-line" size={17} />Add star</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('unstar')}><Icon name="star-off-line" size={17} />Remove star</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('pin')}><Icon name="pushpin-line" size={17} />Pin to top</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('unpin')}><Icon name="unpin-line" size={17} />Unpin</button>
						{:else}
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('read-all', [])}><Icon name="mail-open-line" size={17} />Mark all as read</button>
						{/if}
						{#if view === 'trash'}<div class="menu-hold"><HoldToConfirm label="Empty trash" holdLabel="Keep holding" confirmLabel="Emptied" onConfirm={() => run('empty-trash', [])} /></div>{/if}
					</div>
				{/if}
			</div>
		</div>
		<div class="toolbar-right">
			<div class="layout-toggle" role="group" aria-label="Mailbox layout">
				<button type="button" class="tool-btn" class:on={layout === 'list'} aria-pressed={layout === 'list'} aria-label="List view" title="List view" onclick={() => chooseLayout('list')}><Icon name="list-unordered" size={18} /></button>
				<button type="button" class="tool-btn" class:on={layout === 'cards'} aria-pressed={layout === 'cards'} aria-label="Card view" title="Card view" onclick={() => chooseLayout('cards')}><Icon name="layout-grid-line" size={18} /></button>
			</div>
			<div class="pager">
				<span class="pager-label">{rangeStart}–{rangeEnd} of {mailbox.total}</span>
				<a class="pager-btn" class:disabled={mailbox.page <= 1} aria-disabled={mailbox.page <= 1} tabindex={mailbox.page <= 1 ? -1 : 0} onclick={(event) => { if (mailbox.page <= 1) event.preventDefault(); }} href={withParams({ page: mailbox.page - 1 })} aria-label="Previous page"><Icon name="arrow-left-s-line" size={20} /></a>
				<a class="pager-btn" class:disabled={mailbox.page >= mailbox.pageCount} aria-disabled={mailbox.page >= mailbox.pageCount} tabindex={mailbox.page >= mailbox.pageCount ? -1 : 0} onclick={(event) => { if (mailbox.page >= mailbox.pageCount) event.preventDefault(); }} href={withParams({ page: mailbox.page + 1 })} aria-label="Next page"><Icon name="arrow-right-s-line" size={20} /></a>
			</div>
		</div>
	</header>
	<nav class="filter-tabs" aria-label="Filter conversations">
		<button type="button" class:active={!activeFilterCount} aria-pressed={!activeFilterCount} onclick={() => apply({ unread: null, starred: null, attachments: null })}><Icon name="inbox-line" size={17} />All messages</button>
		<button type="button" class:active={filters.unreadOnly} aria-pressed={filters.unreadOnly} onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}><Icon name="mail-unread-line" size={17} />Unread</button>
		<button type="button" class:active={filters.starredOnly} aria-pressed={filters.starredOnly} onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}><Icon name="star-line" size={17} />Starred</button>
		<button type="button" class:active={filters.attachmentsOnly} aria-pressed={filters.attachmentsOnly} onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}><Icon name="attachment-2" size={17} />Attachments</button>
	</nav>

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
				title={filters.q ? 'No messages match that search' : activeFilterCount ? 'No conversations match these filters' : meta.empty}
			/>
			{#if filters.q || activeFilterCount}
				<div class="empty-actions"><a class="btn-ghost" href={withParams({ q: null, unread: null, starred: null, attachments: null })}>Clear filters</a></div>
			{/if}
		{:else}
			<ul class="cards" class:layout-list={layout === 'list'} class:ios-list={true}>
				{#each items as thread, index (thread.thread_id)}
					<li
						class="card"
						class:unread={!thread.is_read}
						class:checked={selected.includes(thread.latest_id)}
						class:focused={index === focused}
						class:pinned={thread.is_pinned}
						class:select-mode={selectMode}
					>
						<span class="ios-unread-dot" class:visible={!thread.is_read} aria-hidden="true"></span>

						<div class="card-bar">
								<Check
									label={`Select conversation with ${people(thread)}`}
									checked={selected.includes(thread.latest_id)}
									onchange={(_, event) => toggle(thread.latest_id, event)}
								/>
						</div>
						<button type="button" class="row-star tool-btn" class:starred={thread.is_starred} aria-label={thread.is_starred ? 'Remove star' : 'Add star'} title={thread.is_starred ? 'Remove star (s)' : 'Add star (s)'} aria-pressed={thread.is_starred} disabled={busy} onclick={() => toggleStar(thread)}><Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={18} /></button>

						<a
							class="card-link"
							href={href(thread)}
							onfocus={() => (focused = index)}
							onclick={(event) => {
								if (handleMailboxRowClick(selectMode, () => event.preventDefault()) === 'toggle') {
									toggle(thread.latest_id);
								}
							}}
						>
							<span class="avatar" style={avatarStyle(thread)}>{initial(thread)}</span>

							<span class="card-body">
								<span class="card-top-row">
									<span class="sender" title={people(thread)}>
										<span class="sender-names">{people(thread)}</span>
										{#if thread.message_count > 1}
											<span class="count">{thread.message_count}</span>
										{/if}
										{#if thread.is_draft}<span class="tag tag-draft">Draft</span>{/if}
										{#if view === 'trash' && thread.auto_trashed}
											<span class="tag tag-cleaned">Cleaned up</span>
										{/if}
									</span>
									<span class="date">
										{view === 'later' && thread.snoozed_until
											? formatSnoozeUntil(thread.snoozed_until)
											: formatRelativeDate(thread.created_at)}
									</span>
								</span>

								<span class="subject">{thread.subject || '(no subject)'}</span>
								<span class="preview">
									{thread.preview || (thread.has_attachments ? 'Attached files' : 'No message text')}
								</span>

								<span class="card-meta">
									{#each (thread.labels ?? []).slice(0, 2) as label (label.id)}<span class="tag tag-label" title={label.name}>{label.name}</span>{/each}
									{#if (thread.labels?.length ?? 0) > 2}<span class="tag" title={thread.labels?.map((label) => label.name).join(', ')}>+{thread.labels!.length - 2}</span>{/if}
									<span class="indicators">
										{#if thread.is_starred}
											<Icon name="star-fill" size={13} />
										{/if}
										{#if thread.is_pinned}
											<Icon name="pushpin-2-fill" size={13} />
										{/if}
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
								</span>
							</span>
						</a>

						{#if selectMode}
							<button
								type="button"
								class="ios-select-toggle"
								aria-label={selected.includes(thread.latest_id) ? 'Deselect' : 'Select'}
								aria-pressed={selected.includes(thread.latest_id)}
								onclick={() => toggle(thread.latest_id)}
							>
								<span class="ios-select-circle" class:checked={selected.includes(thread.latest_id)}>
									{#if selected.includes(thread.latest_id)}
										<Icon name="check-line" size={14} />
									{/if}
								</span>
							</button>
						{/if}

						<div class="card-actions">
							<div class="row-quick-actions">
								{#if !thread.is_draft && view !== 'trash' && view !== 'spam'}
									<button type="button" class="tool-btn" title="Archive" aria-label="Archive conversation" disabled={busy} onclick={() => run('archive', [thread.latest_id])}><Icon name="archive-line" size={18} /></button>
								{/if}
								<button type="button" class="tool-btn" title={thread.is_read ? 'Mark as unread' : 'Mark as read'} aria-label={thread.is_read ? 'Mark conversation as unread' : 'Mark conversation as read'} disabled={busy} onclick={() => run(thread.is_read ? 'unread' : 'read', [thread.latest_id])}><Icon name={thread.is_read ? 'mail-unread-line' : 'mail-open-line'} size={18} /></button>
								{#if view !== 'trash'}<button type="button" class="tool-btn" title="Move to trash" aria-label="Trash conversation" disabled={busy} onclick={() => run('trash', [thread.latest_id])}><Icon name="delete-bin-line" size={18} /></button>{/if}
							</div>

							<button
								type="button"
								class="tool-btn"
								aria-label="Conversation actions"
								aria-expanded={rowMenuFor === thread.latest_id}
								onclick={() => toggleRowMenu(thread.latest_id)}
							>
								<Icon name="more-2-fill" size={15} />
							</button>
							{#if rowMenuFor === thread.latest_id}
								<button
									type="button"
									class="backdrop"
									aria-label="Close actions"
									onclick={() => {
										rowMenuFor = null;
										snoozeFor = null;
									}}
								></button>
								{#if snoozeFor === thread.latest_id}
									<SnoozeMenu
										onPick={(until) => snoozeIds([thread.latest_id], until)}
										onClose={() => (snoozeFor = null)}
									/>
								{:else}
									<div class="menu menu-right" role="menu">
										<LabelPicker {labels} ids={[thread.latest_id]} existing={[thread.labels ?? []]} disabled={busy} caption="Labels…" />
										{#if view === 'spam' || view === 'all' || view === 'later'}
											<button type="button" class="menu-item" disabled={busy} onclick={() => run('inbox', [thread.latest_id])}><Icon name="inbox-line" size={16} />Move to inbox</button>
										{/if}
										{#if !thread.is_draft && view !== 'trash' && view !== 'spam'}
											<button type="button" class="menu-item" disabled={busy} onclick={() => run('archive', [thread.latest_id])}><Icon name="archive-line" size={16} />Archive</button>
										{/if}
										{#if !thread.is_draft && view !== 'trash'}
											<button type="button" class="menu-item" disabled={busy} onclick={() => run(view === 'spam' ? 'not-spam' : 'spam', [thread.latest_id])}><Icon name="spam-2-line" size={16} />{view === 'spam' ? 'Not spam' : 'Mark as spam'}</button>
										{/if}

										<button
											type="button"
											class="menu-item"
											onclick={() => toggleStar(thread)}
										>
											<Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={15} />
											{thread.is_starred ? 'Remove star' : 'Add star'}
										</button>
										<button
											type="button"
											class="menu-item"
											onclick={() => togglePin(thread)}
										>
											<Icon
												name={thread.is_pinned ? 'pushpin-2-fill' : 'pushpin-2-line'}
												size={15}
											/>
											{thread.is_pinned ? 'Unpin' : 'Pin to top'}
										</button>
										{#if view === 'trash'}
											<button
												type="button"
												class="menu-item"
												onclick={() => run('restore', [thread.latest_id])}
											>
												<Icon name="arrow-go-back-line" size={15} /> Restore
											</button>
											<button
												type="button"
												class="menu-item danger"
												onclick={() => run('delete', [thread.latest_id])}
											>
												<Icon name="delete-bin-2-line" size={15} /> Delete permanently
											</button>
										{:else if view === 'later'}
											<button
												type="button"
												class="menu-item"
												onclick={() => run('unsnooze', [thread.latest_id])}
											>
												<Icon name="inbox-line" size={15} /> Move to inbox
											</button>
											<button
												type="button"
												class="menu-item"
												onclick={() => run('trash', [thread.latest_id])}
											>
												<Icon name="delete-bin-line" size={15} /> Move to trash
											</button>
										{:else}
											{#if !thread.is_draft}
												<button
													type="button"
													class="menu-item"
													onclick={() => goto(`/compose?forward=${thread.latest_id}`)}
												>
													<Icon name="share-forward-line" size={15} /> Forward
												</button>
											{/if}
											<button
												type="button"
												class="menu-item"
												onclick={() => run(thread.is_read ? 'unread' : 'read', [thread.latest_id])}
											>
												<Icon name={thread.is_read ? 'mail-line' : 'mail-open-line'} size={15} />
												{thread.is_read ? 'Mark as unread' : 'Mark as read'}
											</button>
											<button
												type="button"
												class="menu-item"
												onclick={() => (snoozeFor = thread.latest_id)}
											>
												<Icon name="time-line" size={15} /> Snooze
											</button>
											<button
												type="button"
												class="menu-item"
												onclick={() => run('trash', [thread.latest_id])}
											>
												<Icon name="delete-bin-line" size={15} /> Move to trash
											</button>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if mailbox.total > 0}
		<footer class="list-foot">
			<div class="mobile-pager"><a href={withParams({ page: mailbox.page - 1 })} aria-label="Previous page" aria-disabled={mailbox.page <= 1} tabindex={mailbox.page <= 1 ? -1 : 0} onclick={(event) => { if (mailbox.page <= 1) event.preventDefault(); }}><Icon name="arrow-left-s-line" size={22} /></a></div>
			<span>{rangeStart}–{rangeEnd} of {mailbox.total}</span>
			<div class="mobile-pager"><a href={withParams({ page: mailbox.page + 1 })} aria-label="Next page" aria-disabled={mailbox.page >= mailbox.pageCount} tabindex={mailbox.page >= mailbox.pageCount ? -1 : 0} onclick={(event) => { if (mailbox.page >= mailbox.pageCount) event.preventDefault(); }}><Icon name="arrow-right-s-line" size={22} /></a></div>
		</footer>
	{/if}
</section>

<style>
	.mailbox { display: flex; flex-direction: column; min-height: 100%; }
	.mailbox-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.1rem 1.5rem 1.25rem; }
	.eyebrow { font-size: 0.625rem; font-weight: 600; letter-spacing: 0.13em; color: var(--color-text-secondary); margin-bottom: 0.45rem; }
	.mailbox-heading h1 { display: flex; align-items: baseline; gap: 0.8rem; font-size: 1.65rem; font-weight: 600; letter-spacing: -0.045em; }
	.mailbox-heading > div { min-width: 0; }
	.mailbox-heading h1 { flex-wrap: wrap; overflow-wrap: anywhere; }
	.mailbox-heading h1 span { font-size: 0.75rem; font-weight: 400; letter-spacing: 0; color: var(--color-text-secondary); }
	.heading-compose { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; color: var(--color-accent-text); }
	.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; min-height: 3.5rem; padding: 0.4rem 1.2rem; border-top: 1px solid var(--color-line); }
	.toolbar-left, .toolbar-right, .bulk-actions, .select-all, .pager, .layout-toggle { display: flex; align-items: center; gap: 0.2rem; min-width: 0; }
	.toolbar-right { gap: 1rem; }
	.select-all { position: relative; padding-right: 0.5rem; }
	.caret { display: flex; align-items: center; color: var(--color-text-secondary); width: 1rem; }
	.tool-btn { display: flex; align-items: center; justify-content: center; width: 2.125rem; height: 2.125rem; flex-shrink: 0; border-radius: 9px; color: var(--color-text-secondary); transition: background 0.15s, color 0.15s; }
	.tool-btn:hover:not(:disabled) { background: var(--color-surface-hover); color: var(--color-text); }
	.tool-btn:disabled { opacity: 0.4; }
	.tool-btn.on { color: var(--color-accent-text); background: var(--color-surface); box-shadow: var(--shadow-xs); }
	.starred { color: var(--color-star); }
	.tool-divider { height: 1.25rem; border-left: 1px solid var(--color-line); margin: 0 0.4rem; }
	.selected-count { font-size: 0.75rem; color: var(--color-accent-text); margin-left: 0.4rem; white-space: nowrap; }
	.layout-toggle { background: var(--color-well); padding: 0.2rem; border-radius: 11px; }
	.layout-toggle .tool-btn { width: 1.8rem; height: 1.8rem; }
	.pager-label { font-size: 0.75rem; color: var(--color-text-secondary); white-space: nowrap; margin-right: 0.5rem; }
	.pager-btn { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 9px; color: var(--color-text-secondary); }
	.pager-btn:hover { background: var(--color-well); }
	.pager-btn.disabled { opacity: 0.3; pointer-events: none; }
	.filter-tabs { display: flex; gap: 0.5rem; padding: 0 1.2rem; border-bottom: 1px solid var(--color-line); }
	.filter-tabs button { display: flex; align-items: center; gap: 0.5rem; min-height: 3rem; padding: 0 1rem; font-size: 0.8125rem; color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
	.filter-tabs button:hover { background: var(--color-well); border-radius: 8px 8px 0 0; }
	.filter-tabs button.active { color: var(--color-accent-text); border-bottom-color: var(--color-accent); font-weight: 600; }
	.more, .snooze-wrap, .ios-more { position: relative; }
	.backdrop { position: fixed; inset: 0; z-index: 45; cursor: default; }
	.menu { position: absolute; top: calc(100% + 0.3rem); z-index: 46; min-width: 12.5rem; padding: 0.4rem; border: 1px solid var(--color-line); border-radius: 12px; background: var(--color-surface); box-shadow: var(--mat-float); }
	.menu-left { left: 0; }
	.menu-right { right: 0; }
	.menu-item { display: flex; align-items: center; gap: 0.65rem; width: 100%; padding: 0.65rem 0.75rem; border-radius: 7px; color: var(--color-text-secondary); text-align: left; font-size: 0.8125rem; white-space: nowrap; }
	.menu-item:hover:not(:disabled) { color: var(--color-text); background: var(--color-well); }
	.menu-item:disabled { opacity: 0.5; }
	.menu-item.danger { color: var(--color-danger); }
	.menu-hold { padding: 0.25rem; }
	.menu-hold :global(.hold) { width: 100%; }
	.action-error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0.75rem 1rem; padding: 0.75rem 1rem; border: 1px solid var(--color-line); border-radius: 10px; color: var(--color-danger); background: var(--color-surface); }
	.search-note { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; color: var(--color-text-secondary); background: var(--color-well); font-size: 0.8125rem; }
	.search-clear { margin-left: auto; color: var(--color-accent-text); }
	.empty-actions { display: flex; justify-content: center; margin-top: -2rem; margin-bottom: 2rem; }
	.list { padding: 0.7rem 1rem; }
	.cards { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 0.75rem; list-style: none; margin: 0; padding: 0; }
	.card { position: relative; display: grid; grid-template-columns: auto auto 1fr; align-content: start; min-width: 0; min-height: 10rem; gap: 0.5rem; padding: 0.875rem; background: var(--color-well); border: 1px solid var(--color-line); border-radius: 14px; transition: background 0.15s, box-shadow 0.15s; }
	.card.unread { background: var(--color-surface); }
	.card:hover { background: var(--color-surface-hover); }
	.card.checked, .card.checked:hover { background: var(--color-accent-soft); }
	.card.focused:focus-within { box-shadow: inset 3px 0 0 var(--color-accent); }
	.card.pinned { border-left: 3px solid var(--color-accent); }
	.card:has(.backdrop) { z-index: 47; }
	.card-bar { display: flex; align-items: center; }
	.card-link { display: flex; grid-column: 1 / -1; gap: 0.75rem; min-width: 0; color: inherit; }
	.avatar { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 2.25rem; height: 2.25rem; border-radius: 12px; font-size: 0.875rem; font-weight: 600; background: color-mix(in srgb, var(--avatar-bg) 15%, var(--color-surface)); color: var(--avatar-bg); }
	.card-body { display: flex; flex-direction: column; min-width: 0; width: 100%; gap: 0.35rem; }
	.card-top-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; min-width: 0; }
	.sender { display: flex; align-items: center; gap: 0.3rem; min-width: 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.sender-names { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.unread .sender, .unread .subject { color: var(--color-text); font-weight: 600; }
	.count { font-size: 0.7rem; color: var(--color-text-secondary); flex-shrink: 0; font-weight: 400; }
	.subject { font-size: 0.875rem; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.preview { font-size: 0.8125rem; color: var(--color-text-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.5; }
	.date { flex-shrink: 0; font-size: 0.7rem; color: var(--color-text-secondary); white-space: nowrap; }
	.card-meta, .indicators { display: flex; align-items: center; gap: 0.35rem; color: var(--color-text-secondary); min-width: 0; }
	.card-meta { max-width: 12rem; overflow: hidden; }
	.tag { font-size: 0.625rem; padding: 0.1rem 0.3rem; border-radius: 4px; background: var(--color-well); color: var(--color-text-secondary); }
	.tag-draft { color: var(--color-danger); }
	.tag-label { max-width: 5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--color-accent-soft); color: var(--color-accent-text); }
	.card-actions { position: absolute; right: 0.5rem; top: 0.7rem; display: flex; align-items: center; border-radius: 9px; }
	.row-quick-actions { display: flex; opacity: 0; pointer-events: none; background: var(--color-surface-hover); border-radius: 9px; }
	.card:hover .row-quick-actions, .card:focus-within .row-quick-actions { opacity: 1; pointer-events: auto; }
	.list-foot { display: flex; justify-content: flex-end; padding: 0.5rem 1.5rem 1rem; font-size: 0.75rem; color: var(--color-text-secondary); }
	.mobile-pager { display: none; }
	.cards.layout-list { display: flex; flex-direction: column; gap: 0; }
	.cards.layout-list .card { display: flex; align-items: center; gap: 0.45rem; min-height: 3.5rem; padding: 0.55rem 0.6rem; border: 0; border-bottom: 1px solid var(--color-line); border-radius: 0; }
	.cards.layout-list .card:first-child { border-radius: 10px 10px 0 0; }
	.cards.layout-list .card:last-child { border-radius: 0 0 10px 10px; }
	.cards.layout-list .card-link { flex: 1; align-items: center; padding: 0.25rem 2rem 0.25rem 0.3rem; }
	.cards.layout-list .avatar { display: none; }
	.cards.layout-list .card-body { display: grid; grid-template-columns: minmax(7rem,11rem) minmax(8rem,0.8fr) minmax(0,1.2fr) auto 4.5rem; align-items: center; gap: 0.75rem; }
	.cards.layout-list .card-top-row { display: contents; }
	.cards.layout-list .sender { grid-column: 1; grid-row: 1; }
	.cards.layout-list .subject { grid-column: 2; grid-row: 1; }
	.cards.layout-list .preview { display: block; white-space: nowrap; text-overflow: ellipsis; grid-column: 3; grid-row: 1; }
	.cards.layout-list .card-meta { grid-column: 4; grid-row: 1; }
	.cards.layout-list .date { grid-column: 5; grid-row: 1; text-align: right; }
	.cards.layout-list .card-actions { top: 50%; transform: translateY(-50%); right: 0.5rem; }
	.cards.layout-list .card-actions > .tool-btn { background: var(--color-well); }
	.cards.layout-list .unread .card-actions > .tool-btn { background: var(--color-surface); }
	.card:hover .card-actions > .tool-btn { background: var(--color-surface-hover); }
	.ios-header, .ios-filters, .ios-search, .ios-bulk-bar, .ios-unread-dot, .ios-select-toggle { display: none; }
	@media (min-width:901px) and (max-width:1150px) {
		.cards { grid-template-columns: repeat(2,minmax(0,1fr)); }
		.cards.layout-list .card-body { grid-template-columns: minmax(6rem,9rem) minmax(7rem,1fr) auto 3rem; gap: 0.5rem; }
		.cards.layout-list .preview { display: none; }
		.cards.layout-list .card-meta { grid-column: 3; }
		.cards.layout-list .date { grid-column: 4; }
		.selected-count { display: none; }
	}
	@media (max-width:900px) {
		.mailbox-heading, .toolbar, .filter-tabs { display: none; }
		.ios-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.75rem; padding: max(0.75rem,env(safe-area-inset-top)) 1rem 0.75rem; }
		.ios-back, .ios-icon-btn { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 12px; color: var(--color-text-secondary); }
		.ios-back:hover, .ios-icon-btn:hover { background: var(--color-well); }
		.ios-title { font-size: 1.3rem; font-weight: 600; letter-spacing: -0.035em; }
		.ios-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.ios-subtitle { font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.ios-title-block { min-width: 0; }
		.ios-actions, .ios-bulk-actions { display: flex; align-items: center; gap: 0.15rem; }
		.ios-select { font-size: 0.8125rem; color: var(--color-accent-text); }
		.ios-bulk-bar { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; background: var(--color-accent-soft); }
		.ios-bulk-count { font-size: 0.8125rem; color: var(--color-accent-text); }
		.ios-filters { display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 1rem 0.75rem; border-bottom: 1px solid var(--color-line); }
		.ios-filter-icons { display: flex; gap: 0.3rem; }
		.ios-filter-icon { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.5rem; border-radius: 10px; color: var(--color-text-secondary); }
		.ios-filter-icon.active { color: var(--color-accent-text); background: var(--color-accent-soft); }
		.ios-filter-pill { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; height: 2.25rem; padding: 0 0.7rem; border-radius: 9px; color: var(--color-text-secondary); background: var(--color-well); }
		.ios-filter-pill.active { color: var(--color-accent-text); background: var(--color-accent-soft); }
		.ios-search { display: flex; align-items: center; gap: 0.5rem; margin: 0.75rem 1rem; padding: 0.4rem 0.75rem; min-height: 2.75rem; border-radius: 12px; background: var(--color-well); color: var(--color-text-secondary); }
		.ios-search input { min-width: 0; flex: 1; background: transparent; color: var(--color-text); font-size: 1rem; }
		.ios-search-close { display: flex; }
		.list { padding: 0; }
		.cards, .cards.layout-list { display: flex; flex-direction: column; gap: 0; }
		.card, .cards.layout-list .card { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 0.35rem; min-height: 6.6rem; padding: 1rem; border: 0; border-bottom: 1px solid var(--color-line); border-radius: 0 !important; }
		.card-bar, .row-star, .row-quick-actions { display: none; }
		.card-link, .cards.layout-list .card-link { grid-column: 1; padding: 0; display: flex; align-items: flex-start; gap: 0.75rem; }
		.avatar, .cards.layout-list .avatar { display: flex; width: 2.5rem; height: 2.5rem; border-radius: 50%; font-size: 1rem; }
		.card-body, .cards.layout-list .card-body { display: flex; flex-direction: column; align-items: stretch; gap: 0.3rem; }
		.card-top-row, .cards.layout-list .card-top-row { display: flex; justify-content: space-between; }
		.sender { font-size: 0.875rem; }
		.subject { font-size: 0.875rem; }
		.preview, .cards.layout-list .preview { display: -webkit-box; white-space: normal; font-size: 0.8125rem; line-height: 1.45; }
		.card-meta { font-size: 0.75rem; }
		.cards.layout-list .date { text-align: right; font-size: 0.6875rem; }
		.card-actions, .cards.layout-list .card-actions { position: relative; top: auto; right: auto; transform: none; grid-column: 2; }
		.card-actions > .tool-btn { background: transparent !important; width: 2rem; height: 2.75rem; }
		.card-actions .menu { position: fixed; top: auto; bottom: calc(var(--mobile-dock-height) + env(safe-area-inset-bottom) + 1rem); left: 1rem; right: 1rem; max-height: 60dvh; overflow-y: auto; }
		.ios-unread-dot { display: block; position: absolute; left: 0.3rem; top: 1.8rem; width: 0.35rem; height: 0.35rem; border-radius: 50%; }
		.ios-unread-dot.visible { background: var(--color-accent); }
		.ios-select-toggle { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; }
		.ios-select-circle { display: flex; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; border: 2px solid var(--color-line-strong); border-radius: 50%; }
		.ios-select-circle.checked { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
		.card.select-mode .card-actions { display: none; }
		.list-foot { justify-content: center; padding-bottom: 0.5rem; }
		.mobile-pager { display: flex; }
		.mobile-pager a { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; }
		.mobile-pager a[aria-disabled='true'] { opacity: 0.3; pointer-events: none; }
		.list-foot { align-items: center; gap: 1rem; }
		.search-note { padding: 0.75rem 1rem; }
	}

</style>

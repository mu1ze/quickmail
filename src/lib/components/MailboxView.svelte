<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { swipeRow } from '$lib/actions/swipe-row';
	import { motionDuration } from '$lib/interior/motion';
	import { mailboxContextMenu, rowMenuPosition } from '$lib/actions/mailbox-context-menu';
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import AnalysisBadges from './AnalysisBadges.svelte';
	import AnalysisControls from './AnalysisControls.svelte';
	import MailCategories from './MailCategories.svelte';
	import DomainSwitcher from './DomainSwitcher.svelte';
	import NotificationPrompt from './NotificationPrompt.svelte';
	import VerificationCode from './VerificationCode.svelte';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import { CATEGORY_LABELS } from '$lib/mail-analysis';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import EmptyState from './EmptyState.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import SnoozeMenu from './SnoozeMenu.svelte';
	import AdvancedSearch from './AdvancedSearch.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import HoldToConfirm from '$lib/interior/HoldToConfirm.svelte';
	import { formatRelativeDate, formatFullDate } from '$lib/utils/date';
	import { formatSnoozeUntil } from '$lib/snooze';
	import { isGoChordArmed, isTypingTarget } from '$lib/shortcuts';
	import { showUndo } from '$lib/undo';
	import { getShellContext } from '$lib/shell-context';
	import { onSearchFocus } from '$lib/search-focus';
	import { handleMailboxRowClick, toggleSelection } from '$lib/mailbox-select';
	import { participantName, threadHeadline } from '$lib/mailbox-people';
	import { mailboxGroupHeadings } from '$lib/mailbox-groups';
	import { requireOk, requestError } from '$lib/utils/request';
	import {
		readMailboxLayout,
		setMailboxLayout,
		watchMailboxLayout,
		readMailboxDensity, setMailboxDensity, watchMailboxDensity,
		type MailboxDensity,
		type MailboxLayout
	} from '$lib/mailbox-layout';
	import type { Domain, MailboxCounts, MailboxFilters, MailboxPage, MailboxView, ThreadSummary, MailLabel } from '$lib/types';

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
	let items = $state<ThreadSummary[]>(untrack(() => mailbox.threads));
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
	let density = $state<MailboxDensity>('comfortable');
	let selectMode = $state(false);
	let searchOpen = $state(false);
	let advancedOpen = $state(false);
	let selectionAnchor = $state<string | null>(null);
	let searchQuery = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let deskSearchInput = $state<HTMLInputElement | null>(null);
	let viewOpen = $state(false);

	const counts = $derived(($currentPage.data.counts ?? {}) as MailboxCounts);
	const labels = $derived(($currentPage.data.labels ?? []) as MailLabel[]);
	const activeLabel = $derived(labels.find((label) => label.id === filters.labelId));
	const domains = $derived(($currentPage.data.domains ?? []) as Domain[]);
	const activeDomainId = $derived(($currentPage.data.activeDomainId ?? null) as string | null);

	const headerCount = $derived(
		view === 'inbox' && !filters.q
			? `${counts.inbox_unread ?? 0} unread`
			: `${mailbox.total} conversation${mailbox.total === 1 ? '' : 's'}`
	);

	// Snoozed mail is ordered by when it comes back, so date headings would mislead there.
	const headings = $derived(view === 'later' ? items.map(() => null) : mailboxGroupHeadings(items));

	$effect(() => {
		return onSearchFocus(() => {
			searchOpen = true;
			queueMicrotask(() => {
				const phone = matchMedia('(max-width: 900px)').matches;
				(phone ? searchInput : deskSearchInput)?.focus();
			});
		});
	});

	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly, filters.category, filters.needs].filter(Boolean).length
	);

	const subtitle = $derived.by(() => {
		const parts: string[] = [];
		if (activeFilterCount > 0 || filters.unreadOnly) {
			if (filters.unreadOnly) parts.push('Unread');
			if (filters.starredOnly) parts.push('Starred');
			if (filters.attachmentsOnly) parts.push('Attachments');
			if (filters.category) parts.push(({ primary: 'Primary', transactions: 'Transactions', promotions: 'Promotions', updates: 'Updates', newsletters: 'Newsletters', ...CATEGORY_LABELS } as Record<string, string>)[filters.category] ?? 'Filtered');
			if (filters.needs) parts.push('Needs attention');
		} else {
			parts.push('All mail');
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
		density = readMailboxDensity();
		const stopDensity = watchMailboxDensity((next) => { density = next; });
		const stopLayout = watchMailboxLayout((next) => {
			layout = next;
		});
		return () => { stopLayout(); stopDensity(); };
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
	 * everywhere else names the senders, with the address as a fallback.
	 */
	function people(thread: ThreadSummary): string {
		return threadHeadline(thread, view);
	}

	function initial(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		const participant = external ?? thread.participants[0];
		return (participant ? participantName(participant)[0] : '?')?.toUpperCase() || '?';
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

	function openRowMenu(id: string, index: number) {
		moreOpen = false;
		selectMenuOpen = false;
		bulkSnoozeOpen = false;
		snoozeFor = null;
		focused = index;
		rowMenuFor = id;
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

	/** Actions whose result unambiguously removes the row from the mailbox being viewed. */
	function leavesView(action: string): boolean {
		switch (action) {
			case 'trash': return view !== 'trash';
			case 'archive': return view === 'inbox';
			case 'snooze': return view === 'inbox';
			case 'spam': return view !== 'spam';
			case 'not-spam': return view === 'spam';
			case 'restore': case 'delete': return view === 'trash';
			case 'unsnooze': return view === 'later';
			default: return false;
		}
	}

	/** One entry point for every list action; the list updates first, the server confirms after. */
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
		// Apply the outcome immediately; the server confirms afterwards and a failure rolls back.
		const before = items;
		const leaving = leavesView(action) ? target : [];
		if (leaving.length) items = items.filter((row) => !leaving.includes(row.latest_id));
		else if (action === 'read' || action === 'unread') items = items.map((row) => target.includes(row.latest_id) ? { ...row, is_read: action === 'read' } : row);
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
			// Counts and pagination reconcile in the background; the list already shows the result.
			void invalidateAll();
			return true;
		} catch (cause) {
			items = before;
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
		if (event.key === 'Escape') {
			if (document.querySelector('dialog[open]')) return;
			const menuId = rowMenuFor;
			moreOpen = false; viewOpen = false; selectMenuOpen = false; rowMenuFor = null; snoozeFor = null; bulkSnoozeOpen = false;
			if (menuId) {
				void tick().then(() => document.querySelector<HTMLAnchorElement>(`a.card-link[data-message-id="${menuId}"]`)?.focus({ preventScroll: true }));
			} else { selected = []; selectMode = false; selectionAnchor = null; }
			return;
		}
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

	/** Left swipe archives where that makes sense, otherwise trashes; trash and drafts have none. */
	function swipeLeftAction(thread: ThreadSummary): 'archive' | 'trash' | null {
		if (thread.is_draft || view === 'trash' || view === 'drafts') return null;
		return view === 'inbox' || view === 'all' || view === 'starred' || view === 'later' ? 'archive' : 'trash';
	}

	function swipeFor(thread: ThreadSummary) {
		return {
			left: swipeLeftAction(thread) !== null,
			right: !thread.is_draft,
			onSwipe: (direction: 'left' | 'right') => {
				if (direction === 'right') void run(thread.is_read ? 'unread' : 'read', [thread.latest_id]);
				else { const action = swipeLeftAction(thread); if (action) void run(action, [thread.latest_id]); }
			}
		};
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
{#snippet filterControls()}
		<nav class="filter-tabs" aria-label="Filter conversations">
			<button type="button" class:active={filters.unreadOnly} aria-pressed={filters.unreadOnly} onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })} title="Unread"><Icon name="mail-unread-line" size={15} /><span class="filter-text">Unread</span></button>
			<button type="button" class:active={filters.starredOnly} aria-pressed={filters.starredOnly} onclick={() => apply({ starred: filters.starredOnly ? null : '1' })} title="Starred"><Icon name="star-line" size={15} /><span class="filter-text">Starred</span></button>
			<button type="button" class:active={filters.attachmentsOnly} aria-pressed={filters.attachmentsOnly} onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })} title="Attachments"><Icon name="attachment-2" size={15} /><span class="filter-text">Attachments</span></button>
		</nav>
		<label class="attention-filter"><Icon name="focus-3-line" size={15} /><select aria-label="Filter email attention" value={filters.needs ?? ''} onchange={(e)=>apply({needs:e.currentTarget.value || null})}>
			<option value="">Any attention</option><option value="attention">Needs attention</option><option value="review">Review</option><option value="reply">Reply suggested</option><option value="deadline">Deadline mentioned</option>
		</select><Icon name="arrow-down-s-line" size={14} /></label>
		{#if activeFilterCount}<button type="button" class="reset-filters" onclick={() => apply({ unread: null, starred: null, attachments: null, category: null, needs: null })} aria-label="Clear all filters"><Icon name="close-line" size={14} /><span>Reset</span></button>{/if}
{/snippet}
<AdvancedSearch bind:open={advancedOpen} query={filters.q} onSearch={(query) => { searchOpen = false; void goto(`/all${query ? `?q=${encodeURIComponent(query)}` : ''}`); }} />

<section class="mailbox">
	{#if actionError}
		<div class="action-error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss error" onclick={() => (actionError = '')}><Icon name="close-line" size={18} /></button></div>
	{/if}
	<header class="ios-header">
		<button type="button" class="ios-back" aria-label="Open menu" onclick={() => shell?.openNav()}>
			<Icon name="menu-line" size={22} />
		</button>

		<div class="ios-title-block">
			<h1 class="ios-title">{activeLabel?.name ?? meta.title}</h1>
			<p class="ios-subtitle">{subtitle}</p>
		</div>

		<div class="ios-actions">
			{#if $currentPage.data.user && shell}
				<AccountSwitcher user={$currentPage.data.user} accounts={$currentPage.data.accounts} onLogout={shell.logout} compact />
			{/if}
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

	<div class="mailbox-head">
	<header class="mailbox-bar">
		<div class="mailbox-title">
			<h1>{filters.q ? 'Search results' : activeLabel?.name ?? meta.title}</h1>
			<span class="mailbox-count">{headerCount}</span>
			{#if domains.length > 1}<DomainSwitcher {domains} {activeDomainId} />{/if}
		</div>
		<form class="desk-search" role="search" onsubmit={submitSearch}>
			<Icon name="search-line" size={16} />
			<input
				type="search"
				bind:this={deskSearchInput}
				bind:value={searchQuery}
				placeholder="Search mail"
				aria-label="Search messages"
				enterkeyhint="search"
			/>
			{#if searchQuery}
				<button type="button" class="desk-search-btn" aria-label="Clear search" onclick={clearSearch}><Icon name="close-line" size={15} /></button>
			{:else}
				<kbd aria-hidden="true">/</kbd>
			{/if}
			<button type="button" class="desk-search-btn" aria-label="Search options" title="Advanced search" onclick={() => (advancedOpen = true)}><Icon name="equalizer-line" size={17} /></button>
		</form>
		<div class="pager">
			<span class="pager-label">{rangeStart}–{rangeEnd} of {mailbox.total}</span>
			<a class="pager-btn" class:disabled={mailbox.page <= 1} aria-disabled={mailbox.page <= 1} tabindex={mailbox.page <= 1 ? -1 : 0} onclick={(event) => { if (mailbox.page <= 1) event.preventDefault(); }} href={withParams({ page: mailbox.page - 1 })} aria-label="Previous page"><Icon name="arrow-left-s-line" size={20} /></a>
			<a class="pager-btn" class:disabled={mailbox.page >= mailbox.pageCount} aria-disabled={mailbox.page >= mailbox.pageCount} tabindex={mailbox.page >= mailbox.pageCount ? -1 : 0} onclick={(event) => { if (mailbox.page >= mailbox.pageCount) event.preventDefault(); }} href={withParams({ page: mailbox.page + 1 })} aria-label="Next page"><Icon name="arrow-right-s-line" size={20} /></a>
		</div>
	</header>

	<!-- One row: categories and filters normally, the bulk-action bar while anything is selected. -->
	<div class="tabbar" class:selecting={someSelected} aria-busy={busy}>
		{#if someSelected}
			<div class="bulkbar" role="toolbar" aria-label="Selected conversations">
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
				<span class="selected-count" aria-live="polite">{selected.length} selected</span>
				{#if view === 'trash' || view === 'spam' || view === 'all' || view === 'later'}
					<button type="button" class="bulk-btn" title="Move to inbox" disabled={busy} onclick={() => run('inbox')}><Icon name="inbox-line" size={18} /><span>Move to inbox</span></button>
				{/if}
				{#if view !== 'trash' && view !== 'spam' && view !== 'drafts'}
					<button type="button" class="bulk-btn" title="Archive (e)" disabled={busy} onclick={() => run('archive')}><Icon name="archive-line" size={18} /><span>Archive</span></button>
				{/if}
				<button type="button" class="bulk-btn" title={view === 'trash' ? 'Delete permanently' : 'Move to trash (#)'} disabled={busy} onclick={() => run(view === 'trash' ? 'delete' : 'trash')}><Icon name="delete-bin-line" size={18} /><span>{view === 'trash' ? 'Delete' : 'Trash'}</span></button>
				{#if view !== 'trash' && view !== 'spam' && view !== 'drafts'}
					<div class="snooze-wrap">
						<button type="button" class="bulk-btn" title="Snooze (b)" aria-expanded={bulkSnoozeOpen} disabled={busy} onclick={() => (bulkSnoozeOpen = !bulkSnoozeOpen)}><Icon name="time-line" size={18} /><span>Snooze</span></button>
						{#if bulkSnoozeOpen}
							<button type="button" class="backdrop" aria-label="Close snooze" onclick={() => (bulkSnoozeOpen = false)}></button>
							<SnoozeMenu onPick={(until) => snoozeIds(selected, until)} onClose={() => (bulkSnoozeOpen = false)} />
						{/if}
					</div>
				{/if}
				<button type="button" class="bulk-btn" title="Mark as read" disabled={busy} onclick={() => run('read')}><Icon name="mail-open-line" size={18} /><span>Mark read</span></button>
				<LabelPicker {labels} ids={selected} existing={items.filter((row) => selected.includes(row.latest_id)).map((row) => row.labels ?? [])} disabled={busy} />
				<div class="more">
					<button type="button" class="tool-btn" title="More actions" aria-label="More actions" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}><Icon name="more-2-fill" size={18} /></button>
					{#if moreOpen}
						<button type="button" class="backdrop" aria-label="Close menu" onclick={() => (moreOpen = false)}></button>
						<div class="menu menu-left">
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('unread')}><Icon name="mail-unread-line" size={17} />Mark as unread</button>
							{#if view !== 'drafts' && view !== 'trash'}
								<button type="button" class="menu-item" disabled={busy} onclick={() => run(view === 'spam' ? 'not-spam' : 'spam')}><Icon name={view === 'spam' ? 'shield-check-line' : 'spam-2-line'} size={17} />{view === 'spam' ? 'Not spam' : 'Mark as spam'}</button>
							{/if}
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('star')}><Icon name="star-line" size={17} />Add star</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('unstar')}><Icon name="star-off-line" size={17} />Remove star</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('pin')}><Icon name="pushpin-line" size={17} />Pin to top</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('unpin')}><Icon name="unpin-line" size={17} />Unpin</button>
						</div>
					{/if}
				</div>
				<button type="button" class="bulk-btn clear-selection" onclick={() => { selected = []; selectionAnchor = null; }}><Icon name="close-line" size={16} /><span>Clear</span></button>
			</div>
		{/if}
		<div class="tab-main">
			<MailCategories value={filters.category ?? ''} onChange={(category) => apply({ category })} />
			<div class="tab-tools">
				{@render filterControls()}
				<span class="tool-divider"></span>
				<div class="more">
					<button type="button" class="tool-btn" title="View options" aria-label="View options" aria-expanded={viewOpen} onclick={() => (viewOpen = !viewOpen)}><Icon name="layout-row-line" size={18} /></button>
					{#if viewOpen}
						<button type="button" class="backdrop" aria-label="Close view options" onclick={() => (viewOpen = false)}></button>
						<div class="menu menu-right view-menu">
							<p class="menu-label" id="mailbox-layout-label">Layout</p>
							<div class="segmented" role="group" aria-labelledby="mailbox-layout-label">
								<button type="button" aria-pressed={layout === 'list'} onclick={() => chooseLayout('list')}><Icon name="list-unordered" size={16} />List</button>
								<button type="button" aria-pressed={layout === 'cards'} onclick={() => chooseLayout('cards')}><Icon name="layout-grid-line" size={16} />Cards</button>
							</div>
							<p class="menu-label" id="mailbox-density-label">Density</p>
							<div class="segmented" role="group" aria-labelledby="mailbox-density-label">
								<button type="button" aria-pressed={density === 'comfortable'} onclick={() => setMailboxDensity('comfortable')}>Comfortable</button>
								<button type="button" aria-pressed={density === 'compact'} onclick={() => setMailboxDensity('compact')}>Compact</button>
							</div>
						</div>
					{/if}
				</div>
				<div class="more">
					<button type="button" class="tool-btn" title="More actions" aria-label="More actions" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}><Icon name="more-2-fill" size={18} /></button>
					{#if moreOpen}
						<button type="button" class="backdrop" aria-label="Close menu" onclick={() => (moreOpen = false)}></button>
						<div class="menu menu-right">
							<button type="button" class="menu-item" disabled={busy || items.length === 0} onclick={() => { moreOpen = false; selectAll(true); }}><Icon name="checkbox-multiple-line" size={17} />Select all on this page</button>
							<button type="button" class="menu-item" disabled={busy} onclick={() => run('read-all', [])}><Icon name="mail-open-line" size={17} />Mark all as read</button>
							<button type="button" class="menu-item" disabled={busy} onclick={refresh}><Icon name="refresh-line" size={17} />Refresh</button>
							{#if view === 'trash'}<div class="menu-hold"><HoldToConfirm label="Empty trash" holdLabel="Keep holding" confirmLabel="Emptied" onConfirm={() => run('empty-trash', [])} /></div>{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
	<div class="refine-bar">{@render filterControls()}</div>
	</div>
	{#if view === 'inbox' && !filters.q}
		<NotificationPrompt publicKey={($currentPage.data.pushPublicKey ?? null) as string | null} />
	{/if}
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
				<div class="empty-actions"><a class="btn-ghost" href={withParams({ q: null, unread: null, starred: null, attachments: null, category: null, needs: null })}>Clear filters</a></div>
			{/if}
		{:else}
			<ul class="cards" class:layout-list={layout === 'list'} class:compact={density === 'compact'} class:selecting={someSelected} class:ios-list={true}>
				{#each items as thread, index (thread.thread_id)}
					{#if headings[index]}
						<li class="group-head"><h2>{headings[index]}</h2></li>
					{/if}
					<li
						class="card"
						class:unread={!thread.is_read}
						class:checked={selected.includes(thread.latest_id)}
						class:focused={index === focused}
						class:pinned={thread.is_pinned}
						class:select-mode={selectMode}
						class:menu-open={rowMenuFor === thread.latest_id}
						use:mailboxContextMenu={() => openRowMenu(thread.latest_id, index)}
						use:swipeRow={swipeFor(thread)}
						out:slide={{ duration: motionDuration(200) }}
					>
						<span class="swipe-under swipe-under-right" aria-hidden="true"><Icon name={thread.is_read ? 'mail-unread-line' : 'mail-open-line'} size={20} />{thread.is_read ? 'Unread' : 'Read'}</span>
						<span class="swipe-under swipe-under-left" class:danger={swipeLeftAction(thread) === 'trash'} aria-hidden="true"><Icon name={swipeLeftAction(thread) === 'trash' ? 'delete-bin-line' : 'archive-line'} size={20} />{swipeLeftAction(thread) === 'trash' ? 'Trash' : 'Archive'}</span>
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
							data-message-id={thread.latest_id}
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
									<span class="sender" title={thread.participants.filter((person) => !person.self).map((person) => person.address).join(', ') || people(thread)}>
										<span class="sender-names">{people(thread)}</span>
										{#if thread.message_count > 1}
											<span class="count">{thread.message_count}</span>
										{/if}
										{#if thread.is_draft}<span class="tag tag-draft">Draft</span>{/if}
										{#if view === 'trash' && thread.auto_trashed}
											<span class="tag tag-cleaned">Cleaned up</span>
										{/if}
									</span>
									<span class="date" title={formatFullDate(thread.created_at)}>
										{view === 'later' && thread.snoozed_until
											? formatSnoozeUntil(thread.snoozed_until)
											: formatRelativeDate(thread.created_at)}
									</span>
								</span>

								<span class="subject">{#if thread.verification_code}<VerificationCode code={thread.verification_code} />{/if}{thread.subject || '(no subject)'}</span>
								<span class="preview">
									{thread.preview || (thread.has_attachments ? 'Attached files' : 'No message text')}
								</span>

								<span class="card-meta">
									<AnalysisBadges analysis={thread.analysis} />
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
								{#if !thread.is_draft && view !== 'trash' && view !== 'spam' && view !== 'later'}
									<button type="button" class="tool-btn" title="Snooze (b)" aria-label="Snooze conversation" disabled={busy} onclick={() => { openRowMenu(thread.latest_id, index); snoozeFor = thread.latest_id; }}><Icon name="time-line" size={18} /></button>
								{/if}
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
								<div class="row-options" data-overlay="" use:rowMenuPosition>
								{#if snoozeFor === thread.latest_id}
									<SnoozeMenu
										onPick={(until) => snoozeIds([thread.latest_id], until)}
										onClose={() => (snoozeFor = null)}
									/>
								{:else}
									<div class="menu menu-right" role="menu" aria-label="Conversation options">
										{#if thread.analysis && thread.analysisMessageId}
											<AnalysisControls analysis={thread.analysis} categoryId={thread.analysisMessageId} warningIds={[thread.analysisPhishingId,thread.analysisSpamId].filter((id): id is string=>Boolean(id))} taskIds={[thread.analysisReplyId,thread.analysisDeadlineId].filter((id): id is string=>Boolean(id))} />
										{/if}
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
								</div>
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
	.mailbox-head { position: sticky; top: 0; z-index: 20; background: var(--color-surface); }
	.refine-bar { display: none; align-items: center; gap: 0.65rem; margin: 0 1.5rem; padding: 0.4rem 0 0.8rem; border-bottom: 1px solid var(--color-line); }
	.attention-filter { display: flex; align-items: center; gap: 0.4rem; margin-left: auto; color: var(--color-text-secondary); font-size: 0.75rem; min-width: 0; }
	.attention-filter select { appearance: none; background: transparent; color: var(--color-text-secondary); min-height: 2.25rem; padding: 0 0.15rem; max-width: 100%; min-width: 0; cursor: pointer; }
	.attention-filter select option { background: var(--color-surface); color: var(--color-text); }
	.reset-filters { display: flex; align-items: center; gap: 0.25rem; color: var(--color-muted); font-size: 0.7rem; min-height: 2rem; }
	.mailbox-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem; min-height: 4rem; padding: 0.625rem 1rem 0.375rem 1.5rem; box-sizing: border-box; }
	.mailbox-title { display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
	.mailbox-title h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.mailbox-count { font-size: 0.8125rem; color: var(--color-text-secondary); white-space: nowrap; }
	.mailbox-title :global(.switcher) { margin-left: 0.25rem; }
	.desk-search { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 16rem; max-width: 34rem; height: 2.5rem; margin-left: auto; padding: 0 0.375rem 0 0.75rem; border: 1px solid transparent; border-radius: 12px; background: var(--color-well); color: var(--color-muted); transition: border-color 0.15s, background 0.15s; }
	.desk-search:focus-within { border-color: var(--color-accent); background: var(--color-surface); }
	.desk-search input { flex: 1; min-width: 0; background: transparent; outline: none; font-size: 0.875rem; color: var(--color-text); }
	.desk-search input::placeholder { color: var(--color-muted); }
	.desk-search input::-webkit-search-cancel-button { display: none; }
	.desk-search kbd { font: inherit; font-size: 0.6875rem; line-height: 1.4; padding: 0 0.375rem; border: 1px solid var(--color-line-strong); border-radius: 5px; }
	.desk-search-btn { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 8px; color: var(--color-text-secondary); }
	.desk-search-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
	.tabbar { display: flex; align-items: center; min-height: 2.875rem; padding: 0 1rem 0 0.75rem; border-bottom: 1px solid var(--color-line); }
	.tab-main { display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0; }
	.tab-tools { display: flex; align-items: center; gap: 0.35rem; margin-left: auto; flex: none; }
	.tab-tools .attention-filter { margin-left: 0.25rem; }
	@media (min-width: 901px) and (max-width: 1280px) { .tab-main { gap: 0.25rem; } .tab-tools { gap: 0.15rem; } .tab-tools .attention-filter select { max-width: 6.5rem; text-overflow: ellipsis; } }
	@media (min-width: 901px) and (max-width: 1440px) { .tab-tools .filter-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; } .tab-tools .filter-tabs button { padding: 0 0.5rem; } }
	.tabbar.selecting { background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-surface)); }
	.tabbar.selecting .tab-main { display: none; }
	.bulkbar { display: flex; align-items: center; gap: 0.2rem; flex: 1; min-width: 0; padding-left: 0.6rem; }
	.bulk-btn { display: inline-flex; align-items: center; gap: 0.375rem; height: 2rem; padding: 0 0.625rem; border-radius: 9px; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary); white-space: nowrap; transition: background 0.15s, color 0.15s; }
	.bulk-btn:hover:not(:disabled) { background: var(--color-surface-hover); color: var(--color-text); }
	.bulk-btn:disabled { opacity: 0.4; }
	.clear-selection { margin-left: auto; }
	.pager, .select-all { display: flex; align-items: center; gap: 0.2rem; min-width: 0; }
	.select-all { position: relative; padding-right: 0.25rem; }
	.caret { display: flex; align-items: center; color: var(--color-text-secondary); width: 1rem; }
	.tool-btn { display: flex; align-items: center; justify-content: center; width: 2.125rem; height: 2.125rem; flex-shrink: 0; border-radius: 9px; color: var(--color-text-secondary); transition: background 0.15s, color 0.15s; }
	.tool-btn:hover:not(:disabled) { background: var(--color-surface-hover); color: var(--color-text); }
	.tool-btn:disabled { opacity: 0.4; }
	.starred { color: var(--color-star); }
	.tool-divider { height: 1.25rem; border-left: 1px solid var(--color-line); margin: 0 0.25rem; }
	.selected-count { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); margin: 0 0.5rem 0 0.25rem; white-space: nowrap; }
	.pager-label { font-size: 0.75rem; color: var(--color-text-secondary); white-space: nowrap; margin-right: 0.5rem; }
	.pager-btn { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 9px; color: var(--color-text-secondary); }
	.pager-btn:hover { background: var(--color-well); }
	.pager-btn.disabled { opacity: 0.3; pointer-events: none; }
	.view-menu { min-width: 15rem; }
	.menu-label { padding: 0.4rem 0.5rem 0.3rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
	.segmented { display: flex; gap: 0.2rem; padding: 0.2rem; margin: 0 0.25rem 0.4rem; border-radius: 10px; background: var(--color-well); }
	.segmented button { display: flex; flex: 1; align-items: center; justify-content: center; gap: 0.35rem; height: 1.9rem; border-radius: 8px; font-size: 0.75rem; color: var(--color-text-secondary); }
	.segmented button[aria-pressed='true'] { background: var(--color-surface); color: var(--color-text); font-weight: 500; box-shadow: var(--shadow-xs); }
	.filter-tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
	.filter-tabs button { display: flex; align-items: center; gap: 0.4rem; min-height: 1.85rem; padding: 0 0.65rem; border-radius: 999px; font-size: 0.75rem; color: var(--color-muted); }
	.filter-tabs button:hover { background: var(--color-well); color: var(--color-text); }
	.filter-tabs button.active { color: var(--color-accent-text); background: var(--color-accent-soft); font-weight: 500; }

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
	.list { padding: 0 0.75rem 1rem; }
	.cards { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 0.75rem; list-style: none; margin: 0; padding: 0; }
	.card { position: relative; display: grid; grid-template-columns: auto auto 1fr; align-content: start; min-width: 0; min-height: 10rem; gap: 0.5rem; padding: 0.875rem; background: var(--color-well); border: 1px solid var(--color-line); border-radius: 14px; transition: background 0.15s, box-shadow 0.15s; }
	.card.unread { background: var(--color-surface); }
	.card:hover { background: var(--color-surface-hover); }
	.card.checked, .card.checked:hover { background: var(--color-accent-soft); }
	.card.focused:focus-within { box-shadow: inset 3px 0 0 var(--color-accent); }
	.card:has(.backdrop) { z-index: 47; }
	.card-bar { display: flex; align-items: center; }
	.card-link { display: flex; grid-column: 1 / -1; gap: 0.75rem; min-width: 0; color: inherit; }
	.avatar { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 2.25rem; height: 2.25rem; border-radius: 12px; font-size: 0.875rem; font-weight: 600; background: color-mix(in srgb, var(--avatar-bg) 15%, var(--color-surface)); color: color-mix(in srgb, var(--avatar-bg) 60%, var(--color-text)); }
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
	.row-options { position: fixed; z-index: 46; width: 14rem; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; border: 1px solid var(--color-line); border-radius: 12px; background: var(--color-surface); box-shadow: var(--mat-float); }
	.card-actions .row-options :global(.menu) { position: static; min-width: 0; width: 100%; border: 0; box-shadow: none; }
	.card-link { -webkit-touch-callout: none; }
	@media (pointer: coarse) { .card-link { -webkit-user-select: none; user-select: none; } }
	.row-quick-actions { display: flex; opacity: 0; pointer-events: none; background: var(--color-surface-hover); border-radius: 9px; }
	.card:hover .row-quick-actions, .card:focus-within .row-quick-actions { opacity: 1; pointer-events: auto; }
	.list-foot { display: flex; justify-content: flex-end; padding: 0.5rem 1.5rem 1rem; font-size: 0.75rem; color: var(--color-text-secondary); }
	.mobile-pager { display: none; }
	.cards.layout-list { display: flex; flex-direction: column; gap: 0; }
	.cards.layout-list .card { display: flex; align-items: center; gap: 0.55rem; min-height: 4.8rem; padding: 0.85rem 0.6rem; border: 0; border-bottom: 1px solid var(--color-line); border-radius: 0; }
	@media (min-width: 901px) { .cards:not(.layout-list) .indicators :global(.ri-star-fill) { display: none; } }
	.cards.layout-list .card:first-child { border-radius: 10px 10px 0 0; }
	.cards.layout-list .card:last-child { border-radius: 0 0 10px 10px; }
	.cards.layout-list .card-link { flex: 1; align-items: center; padding: 0.25rem 2rem 0.25rem 0.3rem; }
	.cards.layout-list .avatar { display: flex; width: 2.3rem; height: 2.3rem; border-radius: 50%; }
	.cards.layout-list .card-body { display: grid; grid-template-columns: minmax(7rem,10rem) minmax(8rem,0.9fr) minmax(0,1.1fr) auto 4rem; align-items: center; gap: 0.75rem; }
	.cards.layout-list .card-top-row { display: contents; }
	.cards.layout-list .sender { grid-column: 1; grid-row: 1; }
	.cards.layout-list .subject { grid-column: 2; grid-row: 1; }
	.cards.layout-list .preview { display: block; white-space: nowrap; text-overflow: ellipsis; grid-column: 3; grid-row: 1; }
	.cards.layout-list .card-meta { grid-column: 4; grid-row: 1; }
	.cards.layout-list .date { grid-column: 5; grid-row: 1; text-align: right; }
	.cards.layout-list .card-actions { top: 50%; margin-top: -1.0625rem; right: 0.5rem; }
	.group-head { grid-column: 1 / -1; list-style: none; }
	.group-head h2 { padding: 1rem 0.75rem 0.375rem 1.25rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-text-secondary); }
	.group-head:first-child h2 { padding-top: 0.625rem; }
	.cards:not(.layout-list) .group-head h2 { padding-left: 0.25rem; }
	/* Desktop list rows: the avatar turns into a checkbox on hover, and the date gives way to quick actions. */
	@media (min-width: 901px) {
		.cards.layout-list .card { min-height: 3.25rem; padding: 0 0.75rem 0 1.25rem; }
		.cards.layout-list.compact .card { min-height: 2.5rem; }
		.cards.layout-list .card-link { padding: 0.25rem 0; }
		.cards.layout-list .row-star { display: none; }
		.cards.layout-list .avatar { width: 2rem; height: 2rem; font-size: 0.8125rem; }
		.cards.layout-list.compact .avatar { width: 1.75rem; height: 1.75rem; font-size: 0.75rem; }
		.cards.layout-list .ios-unread-dot { display: block; position: absolute; left: 0.5rem; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%; }
		.cards.layout-list .ios-unread-dot.visible { background: var(--color-accent); }
		.cards.layout-list .card-bar { position: absolute; z-index: 2; left: 1.25rem; top: 50%; width: 2rem; height: 2rem; margin-top: -1rem; justify-content: center; opacity: 0; pointer-events: none; }
		.cards.layout-list.compact .card-bar { width: 1.75rem; }
		.cards.layout-list .card:hover .card-bar, .cards.layout-list .card.checked .card-bar, .cards.layout-list.selecting .card-bar { opacity: 1; pointer-events: auto; }
		.cards.layout-list .card:hover .avatar, .cards.layout-list .card.checked .avatar, .cards.layout-list.selecting .avatar { visibility: hidden; }
		.cards.layout-list .card-actions { opacity: 0; pointer-events: none; background: var(--color-surface-hover); }
		.cards.layout-list .card.checked .card-actions { background: linear-gradient(var(--color-accent-soft), var(--color-accent-soft)), var(--color-surface); }
		.cards.layout-list .card:hover .card-actions, .cards.layout-list .card:focus-within .card-actions, .cards.layout-list .card.menu-open .card-actions { opacity: 1; pointer-events: auto; }
		.cards.layout-list .row-quick-actions { opacity: 1; pointer-events: auto; background: transparent; }
		.cards.layout-list .card:hover .date, .cards.layout-list .card:focus-within .date, .cards.layout-list .card.menu-open .date { visibility: hidden; }
	}
	.ios-header, .ios-search, .ios-bulk-bar, .ios-unread-dot, .ios-select-toggle, .swipe-under { display: none; }
	@media (min-width:901px) and (max-width:1150px) {
		.cards { grid-template-columns: repeat(2,minmax(0,1fr)); }
		.cards.layout-list .card-body { grid-template-columns: minmax(6rem,9rem) minmax(7rem,1fr) auto 3rem; gap: 0.5rem; }
		.cards.layout-list .preview { display: none; }
		.cards.layout-list .card-meta { grid-column: 3; }
		.cards.layout-list .date { grid-column: 4; }
		.bulk-btn span { display: none; }
		.bulk-btn.clear-selection span { display: inline; }
	}
	@media (max-width:900px) {
		.mailbox-head { position: static; }
		.mailbox-bar, .tab-tools, .bulkbar { display: none; }
		.tabbar, .tabbar.selecting { padding: 0; border-bottom: 0; background: transparent; }
		.tabbar.selecting .tab-main { display: flex; }
		.group-head h2 { padding: 0.875rem 1rem 0.25rem; }
		.refine-bar { display: flex; margin: 0 1rem; padding: 0 0 0.6rem; flex-wrap: wrap; gap: 0.25rem 0.5rem; }
		.card { position: relative; overflow: hidden; touch-action: pan-y; }
		.card-link, .cards.layout-list .card-link, .card-actions { position: relative; z-index: 1; transform: translateX(var(--swipe-x, 0px)); transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1); }
		.card:global(.swiping) .card-link, .card:global(.swiping) .card-actions { transition: none; }
		/* The swipe transform and clipping would trap the fixed options popup inside the row. */
		.card.menu-open { overflow: visible; }
		.card.menu-open .card-actions { transform: none; }
		.swipe-under { position: absolute; top: 0; bottom: 0; z-index: 2; align-items: center; gap: 0.45rem; padding: 0 1.1rem; overflow: hidden; white-space: nowrap; font-size: 0.8rem; font-weight: 600; color: #fff; }
		.card:not(:global([data-swipe='right'])) .swipe-under-right, .card:not(:global([data-swipe='left'])) .swipe-under-left { display: none; }
		.card:global([data-swipe='right']) .swipe-under-right { display: flex; left: 0; width: max(0px, var(--swipe-x, 0px)); background: #2f7de1; }
		.card:global([data-swipe='left']) .swipe-under-left { display: flex; right: 0; width: max(0px, calc(var(--swipe-x, 0px) * -1)); background: var(--color-accent); color: var(--color-on-accent); }
		.card:global([data-swipe='left']) .swipe-under-left.danger { background: #d92d20; color: #fff; }
		.filter-tabs { width: 100%; gap: 0.2rem; }
		.filter-tabs button { min-height: 2.5rem; padding: 0 0.55rem; }
		.attention-filter { margin-left: 0; }
		.reset-filters { margin-left: auto; }
		.ios-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.75rem; padding: max(0.75rem,env(safe-area-inset-top)) 1rem 0.75rem; }
		.ios-back, .ios-icon-btn { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 12px; color: var(--color-text-secondary); }
		.ios-back:hover, .ios-icon-btn:hover { background: var(--color-well); }
		.ios-title { font-size: 1.8rem; font-weight: 600; letter-spacing: -0.035em; }
		.ios-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.ios-subtitle { font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.ios-title-block { min-width: 0; }
		.ios-actions, .ios-bulk-actions { display: flex; align-items: center; gap: 0.15rem; }
		.ios-select { min-height: 2.75rem; font-size: 0.8125rem; color: var(--color-accent-text); }
		.ios-bulk-bar { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; background: var(--color-accent-soft); }
		.ios-bulk-count { font-size: 0.8125rem; color: var(--color-accent-text); }
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
		.card-actions, .cards.layout-list .card-actions { position: relative; top: auto; right: auto; margin-top: 0; grid-column: 2; }
		.card-actions > .tool-btn { background: transparent !important; width: 2.75rem; height: 2.75rem; }
		.cards.layout-list.compact .card { min-height: 5.25rem; padding-block: 0.75rem; }
		.cards.layout-list.compact .avatar { width: 2rem; height: 2rem; font-size: 0.875rem; }
		.cards.layout-list.compact .card-body { gap: 0.2rem; }
		/* A sheet above the dock, in thumb reach; overrides the desktop popover's inline position. */
		.row-options { top: auto !important; left: 1rem !important; right: 1rem; bottom: calc(var(--mobile-dock-height) + env(safe-area-inset-bottom) + 0.75rem); width: auto; max-width: none; max-height: min(60dvh, calc(100dvh - var(--mobile-dock-height) - env(safe-area-inset-bottom) - 2rem)); border-radius: 16px; }
		.ios-unread-dot { display: block; position: absolute; left: 0.3rem; top: 1.8rem; width: 0.35rem; height: 0.35rem; border-radius: 50%; }
		.ios-unread-dot.visible { background: var(--color-accent); }
		.ios-select-toggle { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; }
		.ios-select-circle { display: flex; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; border: 2px solid var(--color-line-strong); border-radius: 50%; }
		.ios-select-circle.checked { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
		.card.select-mode:not(.menu-open) .card-actions { display: none; }
		.list-foot { justify-content: center; padding-bottom: 0.5rem; }
		.mobile-pager { display: flex; }
		.mobile-pager a { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; }
		.mobile-pager a[aria-disabled='true'] { opacity: 0.3; pointer-events: none; }
		.list-foot { align-items: center; gap: 1rem; }
		.search-note { padding: 0.75rem 1rem; }
	}

</style>

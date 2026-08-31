<script lang="ts">
	import './layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import MobileDock from '$lib/components/MobileDock.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ShortcutSheet from '$lib/components/ShortcutSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import { disablePushForCurrentAccount } from '$lib/push-client';
	import { bindPendingSendFlush } from '$lib/pending-send';
	import { armGoChord, consumeGoChord, isMod, isTypingTarget } from '$lib/shortcuts';
	import { watchSystemTheme } from '$lib/theme';
	import { runUndo } from '$lib/undo';
	import { setShellContext } from '$lib/shell-context';
	import { requestSearchFocus } from '$lib/search-focus';
	import type { LayoutData } from './$types';

	const MAILBOX_ROUTES = ['/inbox', '/starred', '/drafts', '/sent', '/later', '/trash'];

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Onboarding runs before the user has an address, so the shell would be empty.
	const showShell = $derived(Boolean(data.user) && $page.url.pathname !== '/onboarding');

	// Pages that read better centred than full-bleed.
	const NARROW = ['/compose', '/mail', '/settings'];
	const narrow = $derived(NARROW.some((path) => $page.url.pathname.startsWith(path)));

	let collapsed = $state(false);
	let mobileOpen = $state(false);
	let searchInput = $state<HTMLInputElement | null>(null);
	let paletteOpen = $state(false);
	let sheetOpen = $state(false);

	const composing = $derived($page.url.pathname.startsWith('/compose'));
	const mailboxRoute = $derived(MAILBOX_ROUTES.includes($page.url.pathname));

	// app.html already applied the theme; this keeps "System" live afterwards.
	$effect(() => watchSystemTheme());

	// Remember the collapsed sidebar between visits.
	$effect(() => {
		collapsed = localStorage.getItem('mail:sidebar-collapsed') === '1';
	});

	function toggleCollapsed(next: boolean) {
		localStorage.setItem('mail:sidebar-collapsed', next ? '1' : '0');
	}

	$effect(() => {
		toggleCollapsed(collapsed);
	});

	let lastPath = '';
	$effect(() => {
		const path = $page.url.pathname;
		if (lastPath && path !== lastPath) mobileOpen = false;
		lastPath = path;
	});

	$effect(() => {
		document.body.classList.toggle('nav-open', mobileOpen);
		return () => document.body.classList.remove('nav-open');
	});

	$effect(() => {
		if (!showShell) return;
		return bindPendingSendFlush();
	});

	const GO_DEST: Record<string, string> = {
		i: '/inbox',
		s: '/starred',
		d: '/drafts',
		t: '/sent',
		b: '/later',
		e: '/trash'
	};

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && mobileOpen) mobileOpen = false;
		if (!showShell) return;
		if (isTypingTarget(event.target) || document.querySelector('[data-overlay]')) return;

		if (isMod(event) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			event.stopImmediatePropagation();
			paletteOpen = true;
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
		if (consumeGoChord()) {
			const dest = GO_DEST[key];
			if (dest) {
				event.preventDefault();
				event.stopImmediatePropagation();
				void goto(dest);
			}
			return;
		}

		if (key === 'c') {
			event.preventDefault();
			event.stopImmediatePropagation();
			void goto('/compose');
			return;
		}
		if (key === '/') {
			event.preventDefault();
			event.stopImmediatePropagation();
			handleDockSearch();
			return;
		}
		if (key === '?') {
			event.preventDefault();
			event.stopImmediatePropagation();
			sheetOpen = true;
			return;
		}
		if (key === 'g') {
			event.preventDefault();
			event.stopImmediatePropagation();
			armGoChord();
			return;
		}
		if (key === 'z') {
			event.preventDefault();
			event.stopImmediatePropagation();
			void runUndo();
		}
	}

	function focusSearchField() {
		mobileOpen = false;
		searchInput?.focus();
		searchInput?.scrollIntoView({ block: 'nearest' });
	}

	function handleDockSearch() {
		mobileOpen = false;
		if (mailboxRoute) requestSearchFocus();
		else focusSearchField();
	}

	setShellContext({
		openNav: () => (mobileOpen = true),
		focusSearch: handleDockSearch
	});

	async function logout() {
		try {
			await disablePushForCurrentAccount();
		} catch (error) {
			console.warn('Could not fully remove the push subscription during logout', error);
		} finally {
			await fetch('/api/auth/login', { method: 'DELETE' });
			window.location.href = '/login';
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:window onkeydowncapture={onWindowKeydown} />

{#if showShell}
	<div
		class="app-shell"
		class:has-dock={!composing}
		class:mailbox-mobile={mailboxRoute}
		class:compose-mobile={composing}
		data-collapsed={collapsed}
	>
		<Sidebar
			counts={data.counts}
			domains={data.domains}
			activeDomainId={data.activeDomainId}
			isAdmin={data.user!.is_admin}
			bind:collapsed
			bind:mobileOpen
		/>

		<div class="app-content">
			{#if !mailboxRoute && !composing}
				<Topbar
					userName={data.user!.name}
					userEmail={data.user!.email}
					addresses={data.addresses}
					bind:searchInput
					onToggleNav={() => (mobileOpen = !mobileOpen)}
					onLogout={logout}
				/>
			{/if}

			<main class="app-main" class:app-main-narrow={narrow}>
				{@render children()}
			</main>
		</div>

		{#if !composing}
			<MobileDock
				menuOpen={mobileOpen}
				onOpenMenu={() => (mobileOpen = !mobileOpen)}
				onSearch={handleDockSearch}
			/>
		{/if}

		<CommandPalette bind:open={paletteOpen} onSearch={focusSearchField} />
		<ShortcutSheet bind:open={sheetOpen} />
		<UndoToast />
	</div>
{:else}
	{@render children()}
{/if}

export const MAILBOX_ROUTES = [
	'/inbox',
	'/starred',
	'/drafts',
	'/sent',
	'/later',
	'/all',
	'/spam',
	'/trash'
] as const;

export function isMailboxRoute(pathname: string): boolean {
	return (MAILBOX_ROUTES as readonly string[]).includes(pathname);
}

export function isHubRoute(pathname: string): boolean {
	return (
		pathname === '/settings' ||
		pathname.startsWith('/settings/') ||
		pathname === '/admin' ||
		pathname.startsWith('/admin/')
	);
}

export function isComposeRoute(pathname: string): boolean {
	return pathname.startsWith('/compose');
}

export function isMailRoute(pathname: string): boolean {
	return pathname.startsWith('/mail/');
}

/** Topbar stays mounted; CSS hides it on these mobile routes. */
export function hideTopbarOnMobile(pathname: string): boolean {
	return (
		isMailboxRoute(pathname) ||
		isHubRoute(pathname) ||
		isComposeRoute(pathname) ||
		isMailRoute(pathname)
	);
}

/**
 * Mailbox pages carry their own header with search, and settings/admin pages
 * navigate from the sidebar, so the topbar steps aside there at every width.
 */
export function hideTopbar(pathname: string): boolean {
	return isMailboxRoute(pathname) || isHubRoute(pathname);
}

/** Inbox dock covers the reading surface; hide it on compose and open mail. */
export function hideMobileDock(pathname: string): boolean {
	return isComposeRoute(pathname) || isMailRoute(pathname);
}

export function hideDockSearch(pathname: string): boolean {
	return isHubRoute(pathname);
}

export type SearchFocusAction = 'mailbox' | 'topbar' | 'inbox-then-mailbox';

export function resolveSearchFocusAction(input: {
	pathname: string;
	mobileViewport: boolean;
}): SearchFocusAction {
	if (isMailboxRoute(input.pathname)) return 'mailbox';
	if (isHubRoute(input.pathname)) return 'inbox-then-mailbox';
	return 'topbar';
}

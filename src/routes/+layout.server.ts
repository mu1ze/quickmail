import type { LayoutServerLoad } from './$types';
import { getMailboxCounts } from '$lib/server/mail-store';
import type { MailboxCounts } from '$lib/types';
import { listMailLabels } from '$lib/server/mail-labels';

const EMPTY_COUNTS: MailboxCounts = {
	inbox: 0,
	inbox_unread: 0,
	starred: 0,
	drafts: 0,
	sent: 0,
	later: 0,
	trash: 0
};

export const load: LayoutServerLoad = async ({ locals, platform, depends }) => {
	const db = platform?.env.DB;
	// Refreshed on its own when a page changes read state outside a load.
	depends('app:mailbox-counts');

	// The sidebar shows these on every page, so they load with the shell.
	const counts =
		db && locals.user
			? await getMailboxCounts(db, locals.user.id, locals.activeDomainId)
			: EMPTY_COUNTS;

	return {
		labels: db && locals.user ? await listMailLabels(db, locals.user.id) : [],
		user: locals.user,
		domains: locals.domains,
		addresses: locals.addresses,
		activeDomainId: locals.activeDomainId,
		counts
	};
};

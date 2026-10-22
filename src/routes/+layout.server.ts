import type { LayoutServerLoad } from './$types';
import { getMailboxCounts } from '$lib/server/mail-store';
import type { MailboxCounts } from '$lib/types';
import { listMailLabels } from '$lib/server/mail-labels';
import { readVapidConfiguration } from '$lib/server/push-notifications';
import { browserSessions } from '$lib/server/browser-accounts';

const EMPTY_COUNTS: MailboxCounts = {
	inbox: 0,
	inbox_unread: 0,
	starred: 0,
	drafts: 0,
	sent: 0,
	later: 0,
	trash: 0
};

export const load: LayoutServerLoad = async ({ locals, platform, depends, cookies }) => {
	const db = platform?.env.DB;
	// Refreshed on its own when a page changes read state outside a load.
	depends('app:mailbox-counts');

	// The sidebar shows these on every page, so they load with the shell.
	const counts =
		db && locals.user
			? await getMailboxCounts(db, locals.user.id, locals.activeDomainId)
			: EMPTY_COUNTS;

	return {
		accounts: db && locals.authMethod !== 'api_token'
			? (await browserSessions(db, cookies)).map(({ user }) => ({ id: user.id, name: user.name, email: user.email }))
			: [],
		labels: db && locals.user ? await listMailLabels(db, locals.user.id) : [],
		user: locals.user,
		domains: locals.domains,
		addresses: locals.addresses,
		activeDomainId: locals.activeDomainId,
		counts,
		// Lets the inbox offer to turn on notifications without a trip to Settings.
		pushPublicKey: platform?.env ? (readVapidConfiguration(platform.env)?.publicKey ?? null) : null
	};
};

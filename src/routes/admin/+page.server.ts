import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers } from '$lib/server/auth';
import {
	safeEmailProviderKind,
	listAvailableDomains,
	providerLoadError
} from '$lib/server/context';
import {
	buildAdminPermissionMatrix,
	listAllDomainPermissionRows
} from '$lib/server/domain-permissions';
import { listAllAddresses, listUnroutedEmails } from '$lib/server/domains';
import type { DomainPermissionFlags } from '$lib/types';

const EMPTY_PERMISSIONS: Record<string, Record<string, DomainPermissionFlags>> = {};

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		throw error(403, 'Forbidden');
	}

	const providerKind = safeEmailProviderKind(platform);
	const db = platform?.env.DB;
	if (!db) {
		return {
			users: [],
			addresses: [],
			domains: locals.domains,
			available: [],
			unrouted: [],
			domainPermissions: EMPTY_PERMISSIONS,
			providerKind,
			loadError: 'Database unavailable'
		};
	}

	const [users, addresses, unrouted, permissionRows] = await Promise.all([
		listUsers(db),
		listAllAddresses(db),
		listUnroutedEmails(db, 25),
		listAllDomainPermissionRows(db)
	]);

	const domainPermissions = buildAdminPermissionMatrix(users, locals.domains, permissionRows);

	try {
		const available = await listAvailableDomains(
			platform,
			locals.domains.map((domain) => domain.id)
		);

		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available,
			domainPermissions,
			providerKind,
			loadError: null
		};
	} catch (err) {
		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available: [],
			domainPermissions,
			providerKind,
			loadError: providerLoadError(providerKind, err)
		};
	}
};

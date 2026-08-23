import type { D1Database } from '@cloudflare/workers-types';
import type { Domain, DomainPermissionFlags, User } from '$lib/types';

export const FULL_DOMAIN_PERMISSION: DomainPermissionFlags = {
	can_send: true,
	can_receive: true,
	can_create_address: true
};

type PermissionRow = {
	user_id?: string;
	domain_id: string;
	can_send: number;
	can_receive: number;
	can_create_address: number;
};

export function flagsFromRow(row: PermissionRow | null | undefined): DomainPermissionFlags {
	if (!row) return FULL_DOMAIN_PERMISSION;
	return {
		can_send: row.can_send === 1,
		can_receive: row.can_receive === 1,
		can_create_address: row.can_create_address === 1
	};
}

export function isFullDomainPermission(flags: DomainPermissionFlags): boolean {
	return flags.can_send && flags.can_receive && flags.can_create_address;
}

export function effectiveDomainPermission(
	user: Pick<User, 'is_admin'>,
	row: PermissionRow | null | undefined
): DomainPermissionFlags {
	if (user.is_admin) return FULL_DOMAIN_PERMISSION;
	return flagsFromRow(row);
}

/** Show a domain in the switcher/settings when the user can use it or already owns mail there. */
export function domainIsVisibleToUser(
	domainId: string,
	flags: DomainPermissionFlags,
	ownedDomainIds: ReadonlySet<string>
): boolean {
	return (
		flags.can_send ||
		flags.can_receive ||
		flags.can_create_address ||
		ownedDomainIds.has(domainId)
	);
}

export function parseDomainPermissionFlags(input: unknown): DomainPermissionFlags | null {
	if (!input || typeof input !== 'object') return null;
	const body = input as Record<string, unknown>;
	if (
		typeof body.can_send !== 'boolean' ||
		typeof body.can_receive !== 'boolean' ||
		typeof body.can_create_address !== 'boolean'
	) {
		return null;
	}
	return {
		can_send: body.can_send,
		can_receive: body.can_receive,
		can_create_address: body.can_create_address
	};
}

export async function listDomainPermissionRows(
	db: D1Database,
	userId: string
): Promise<Map<string, DomainPermissionFlags>> {
	const { results } = await db
		.prepare(
			`SELECT domain_id, can_send, can_receive, can_create_address
			 FROM domain_permissions WHERE user_id = ?`
		)
		.bind(userId)
		.all<PermissionRow>();

	return new Map(results.map((row) => [row.domain_id, flagsFromRow(row)]));
}

export async function listAllDomainPermissionRows(
	db: D1Database
): Promise<Array<PermissionRow & { user_id: string }>> {
	const { results } = await db
		.prepare(
			`SELECT user_id, domain_id, can_send, can_receive, can_create_address
			 FROM domain_permissions`
		)
		.all<PermissionRow & { user_id: string }>();
	return results;
}

/**
 * Effective flags for every connected domain. Missing rows stay fully allowed
 * so existing deploys keep working until an admin throttles someone.
 */
export function permissionMapForUser(
	user: Pick<User, 'id' | 'is_admin'>,
	domains: readonly Domain[],
	rows: ReadonlyMap<string, DomainPermissionFlags>
): Record<string, DomainPermissionFlags> {
	const permissions: Record<string, DomainPermissionFlags> = {};
	for (const domain of domains) {
		permissions[domain.id] = user.is_admin
			? FULL_DOMAIN_PERMISSION
			: (rows.get(domain.id) ?? FULL_DOMAIN_PERMISSION);
	}
	return permissions;
}

export function buildAdminPermissionMatrix(
	users: readonly Pick<User, 'id' | 'is_admin'>[],
	domains: readonly Domain[],
	rows: ReadonlyArray<PermissionRow & { user_id: string }>
): Record<string, Record<string, DomainPermissionFlags>> {
	const byUser = new Map<string, Map<string, DomainPermissionFlags>>();
	for (const row of rows) {
		let inner = byUser.get(row.user_id);
		if (!inner) {
			inner = new Map();
			byUser.set(row.user_id, inner);
		}
		inner.set(row.domain_id, flagsFromRow(row));
	}

	const matrix: Record<string, Record<string, DomainPermissionFlags>> = {};
	for (const user of users) {
		matrix[user.id] = permissionMapForUser(user, domains, byUser.get(user.id) ?? new Map());
	}
	return matrix;
}

export async function getDomainPermissionFlags(
	db: D1Database,
	user: Pick<User, 'id' | 'is_admin'>,
	domainId: string
): Promise<DomainPermissionFlags> {
	if (user.is_admin) return FULL_DOMAIN_PERMISSION;

	const row = await db
		.prepare(
			`SELECT domain_id, can_send, can_receive, can_create_address
			 FROM domain_permissions WHERE user_id = ? AND domain_id = ?`
		)
		.bind(user.id, domainId)
		.first<PermissionRow>();

	return flagsFromRow(row);
}

/** Inbound routing only has a user id — look up admin status and any throttle in one query. */
export async function userMayReceiveOnDomain(
	db: D1Database,
	userId: string,
	domainId: string
): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT u.is_admin, p.can_send, p.can_receive, p.can_create_address
			 FROM users u
			 LEFT JOIN domain_permissions p ON p.user_id = u.id AND p.domain_id = ?
			 WHERE u.id = ?`
		)
		.bind(domainId, userId)
		.first<{
			is_admin: number;
			can_send: number | null;
			can_receive: number | null;
			can_create_address: number | null;
		}>();

	if (!row) return false;
	if (row.is_admin === 1) return true;
	if (row.can_receive == null) return true;
	return row.can_receive === 1;
}

export async function setUserDomainPermission(
	db: D1Database,
	input: {
		actor: Pick<User, 'id' | 'is_admin'>;
		userId: string;
		domainId: string;
		flags: DomainPermissionFlags;
	}
): Promise<DomainPermissionFlags> {
	if (!input.actor.is_admin) {
		throw new Error('Forbidden');
	}

	const target = await db
		.prepare('SELECT id, is_admin FROM users WHERE id = ?')
		.bind(input.userId)
		.first<{ id: string; is_admin: number }>();
	if (!target) {
		throw new Error('User not found');
	}
	if (target.is_admin === 1) {
		throw new Error('Admins can use every connected domain');
	}

	const domain = await db
		.prepare('SELECT id FROM domains WHERE id = ?')
		.bind(input.domainId)
		.first<{ id: string }>();
	if (!domain) {
		throw new Error('Domain is not connected');
	}

	if (isFullDomainPermission(input.flags)) {
		await db
			.prepare('DELETE FROM domain_permissions WHERE user_id = ? AND domain_id = ?')
			.bind(input.userId, input.domainId)
			.run();
		return FULL_DOMAIN_PERMISSION;
	}

	await db
		.prepare(
			`INSERT INTO domain_permissions (user_id, domain_id, can_send, can_receive, can_create_address, updated_at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, domain_id) DO UPDATE SET
				can_send = excluded.can_send,
				can_receive = excluded.can_receive,
				can_create_address = excluded.can_create_address,
				updated_at = excluded.updated_at`
		)
		.bind(
			input.userId,
			input.domainId,
			input.flags.can_send ? 1 : 0,
			input.flags.can_receive ? 1 : 0,
			input.flags.can_create_address ? 1 : 0
		)
		.run();

	return input.flags;
}

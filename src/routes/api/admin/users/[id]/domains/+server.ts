import { json, type RequestHandler } from '@sveltejs/kit';
import {
	parseDomainPermissionFlags,
	setUserDomainPermission
} from '$lib/server/domain-permissions';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	const domainId = typeof payload?.domainId === 'string' ? payload.domainId : '';
	const flags = parseDomainPermissionFlags(payload);
	if (!domainId || !flags) {
		return json(
			{ error: 'domainId, can_send, can_receive, and can_create_address are required' },
			{ status: 400 }
		);
	}

	try {
		const permission = await setUserDomainPermission(db, {
			actor: locals.user,
			userId: params.id!,
			domainId,
			flags
		});
		return json({ ok: true, permission });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update domain access';
		const status = message === 'Forbidden' ? 403 : 400;
		return json({ error: message }, { status });
	}
};

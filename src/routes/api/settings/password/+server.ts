import { json, type RequestHandler } from '@sveltejs/kit';
import {
	changeOwnPassword,
	MIN_PASSWORD_LENGTH,
	readSessionToken
} from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ request, locals, platform, cookies }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (locals.authMethod !== 'session') {
		return json(
			{ error: 'API keys cannot change passwords. Sign in with a browser session.' },
			{ status: 403 }
		);
	}

	const sessionToken = readSessionToken(cookies);
	if (!sessionToken) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { currentPassword?: unknown; newPassword?: unknown };
	try {
		body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
		return json({ error: 'Current and new passwords are required' }, { status: 400 });
	}

	if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
		return json(
			{ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
			{ status: 400 }
		);
	}

	try {
		await changeOwnPassword(db, {
			userId: locals.user.id,
			currentPassword: body.currentPassword,
			newPassword: body.newPassword,
			currentSessionToken: sessionToken
		});
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to change password' },
			{ status: 400 }
		);
	}
};

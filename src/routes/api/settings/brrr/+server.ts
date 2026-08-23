import { json, type RequestHandler } from '@sveltejs/kit';
import {
	BrrrSettingsError,
	deleteBrrrSettings,
	loadBrrrSettings,
	saveBrrrSettings
} from '$lib/server/brrr';

function sessionDenied() {
	return json(
		{ error: 'API keys cannot manage Brrr destinations. Sign in with a browser session.' },
		{ status: 403 }
	);
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	return json(await loadBrrrSettings(db, locals.user.id));
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	let body: { webhook?: unknown; defaultSound?: unknown; senderSounds?: unknown };
	try {
		body = (await request.json()) as {
			webhook?: unknown;
			defaultSound?: unknown;
			senderSounds?: unknown;
		};
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		const settings = await saveBrrrSettings(db, locals.user.id, body);
		return json(settings);
	} catch (error) {
		if (error instanceof BrrrSettingsError) {
			return json({ error: error.message }, { status: 400 });
		}
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to save Brrr destination' },
			{ status: 500 }
		);
	}
};

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	await deleteBrrrSettings(db, locals.user.id);
	return json({
		configured: false,
		preview: null,
		defaultSound: 'default',
		senderSounds: []
	});
};

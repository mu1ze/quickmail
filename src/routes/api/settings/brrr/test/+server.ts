import { json, type RequestHandler } from '@sveltejs/kit';
import {
	BrrrSettingsError,
	buildBrrrTestPayload,
	loadBrrrDestination,
	parseBrrrSound,
	sendBrrrNotification
} from '$lib/server/brrr';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return json(
			{ error: 'API keys cannot manage Brrr destinations. Sign in with a browser session.' },
			{ status: 403 }
		);
	}

	const destination = await loadBrrrDestination(db, locals.user.id);
	if (!destination) {
		return json({ error: 'Save a Brrr webhook before sending a test.' }, { status: 400 });
	}

	let sound = destination.defaultSound;
	if (request.headers.get('content-type')?.includes('application/json')) {
		try {
			const body = (await request.json()) as { sound?: unknown };
			if (body.sound != null) {
				if (parseBrrrSound(body.sound, 'default') !== body.sound) {
					throw new BrrrSettingsError('Choose a supported Brrr sound.');
				}
				sound = parseBrrrSound(body.sound);
			}
		} catch (error) {
			if (error instanceof BrrrSettingsError) {
				return json({ error: error.message }, { status: 400 });
			}
			if (error instanceof SyntaxError) {
				return json({ error: 'Invalid request' }, { status: 400 });
			}
		}
	}

	try {
		const result = await sendBrrrNotification(destination.webhookKey, buildBrrrTestPayload(sound));
		if (!result.ok) {
			console.error('Failed to send Brrr test notification', result.status);
			return json({ error: 'Brrr did not accept the test notification.' }, { status: 502 });
		}
		return json({ ok: true });
	} catch (error) {
		console.error(
			'Failed to send Brrr test notification',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return json({ error: 'Could not reach Brrr.' }, { status: 502 });
	}
};

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	loadMailAutomations,
	MailAutomationsError,
	saveMailAutomations,
	viewMailAutomations
} from '$lib/server/mail-automations';

function sessionDenied() {
	return json(
		{ error: 'API keys cannot manage mailbox automations. Sign in with a browser session.' },
		{ status: 403 }
	);
}

function aiAvailable(env: App.Platform['env'] | undefined): boolean {
	return Boolean(env?.AI);
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	const settings = await loadMailAutomations(db, locals.user.id);
	return json(viewMailAutomations(settings, aiAvailable(platform?.env)));
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	let body: {
		weeklyCleanup?: unknown;
		aiClassify?: unknown;
		aiSummaries?: unknown;
		rules?: unknown;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		const settings = await saveMailAutomations(db, locals.user.id, body);
		return json(viewMailAutomations(settings, aiAvailable(platform?.env)));
	} catch (error) {
		if (error instanceof MailAutomationsError) {
			return json({ error: error.message }, { status: 400 });
		}
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to save automations' },
			{ status: 500 }
		);
	}
};

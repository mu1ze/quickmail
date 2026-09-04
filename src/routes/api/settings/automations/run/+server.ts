import { json, type RequestHandler } from '@sveltejs/kit';
import { loadMailAutomations, runUserAutomations } from '$lib/server/mail-automations';

function sessionDenied() {
	return json(
		{ error: 'API keys cannot run mailbox automations. Sign in with a browser session.' },
		{ status: 403 }
	);
}

export const POST: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (locals.authMethod !== 'session') {
		return sessionDenied();
	}

	const settings = await loadMailAutomations(db, locals.user.id);
	if (!settings.weeklyCleanup && !settings.aiSummaries) {
		return json(
			{ error: 'Turn on weekly cleanup or AI summaries before running.' },
			{ status: 400 }
		);
	}

	const result = await runUserAutomations(db, locals.user.id, platform.env.AI);
	const next = await loadMailAutomations(db, locals.user.id);
	return json({
		...result,
		lastCleanupAt: next.lastCleanupAt,
		lastCleanupTrashed: next.lastCleanupTrashed
	});
};

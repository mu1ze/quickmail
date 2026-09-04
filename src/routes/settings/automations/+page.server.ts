import type { PageServerLoad } from './$types';
import { loadMailAutomations, viewMailAutomations } from '$lib/server/mail-automations';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return {
			automations: viewMailAutomations(
				{
					weeklyCleanup: false,
					aiClassify: false,
					aiSummaries: false,
					rules: [],
					lastCleanupAt: null,
					lastCleanupTrashed: 0
				},
				false
			)
		};
	}

	const settings = await loadMailAutomations(db, locals.user.id);
	return { automations: viewMailAutomations(settings, Boolean(platform.env.AI)) };
};

import type { PageServerLoad } from './$types';
import { listApiTokens } from '$lib/server/api-tokens';
import { BRRR_SOUND_OPTIONS, loadBrrrSettings } from '$lib/server/brrr';
import { getEmailSignature } from '$lib/server/email-signature';
import { readVapidConfiguration } from '$lib/server/push-notifications';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const signature = locals.user && db ? await getEmailSignature(db, locals.user.id) : '';
	const apiTokens = locals.user && db ? await listApiTokens(db, locals.user.id) : [];
	const vapid = platform?.env ? readVapidConfiguration(platform.env) : null;
	const brrr =
		locals.user && db
			? await loadBrrrSettings(db, locals.user.id)
			: {
					configured: false,
					preview: null,
					defaultSound: 'default' as const,
					senderSounds: []
				};

	return {
		domains: locals.domains,
		addressableDomains: locals.domains.filter(
			(domain) => locals.user?.is_admin || locals.domainPermissions[domain.id]?.can_create_address !== false
		),
		domainPermissions: locals.domainPermissions,
		addresses: locals.addresses,
		signature,
		apiTokens,
		push: {
			configured: Boolean(vapid),
			publicKey: vapid?.publicKey ?? null
		},
		brrr,
		brrrSounds: BRRR_SOUND_OPTIONS,
		isAdmin: locals.user?.is_admin ?? false
	};
};

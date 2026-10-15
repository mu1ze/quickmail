import type { LayoutServerLoad } from './$types';
import { listApiTokens } from '$lib/server/api-tokens';
import { BRRR_SOUND_OPTIONS, loadBrrrSettings } from '$lib/server/brrr';
import { listSignatures } from '$lib/server/email-signature';
import { readVapidConfiguration } from '$lib/server/push-notifications';
import { loadNotificationPrefs } from '$lib/server/notification-preferences';
import { DEFAULT_NOTIFICATION_PREFS } from '$lib/notification-rules';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const signatures = locals.user && db ? await listSignatures(db, locals.user.id) : [];
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
		signatures,
		apiTokens,
		push: {
			configured: Boolean(vapid),
			publicKey: vapid?.publicKey ?? null
		},
		brrr,
		brrrSounds: BRRR_SOUND_OPTIONS,
		notificationPrefs: locals.user && db ? await loadNotificationPrefs(db, locals.user.id) : DEFAULT_NOTIFICATION_PREFS,
		isAdmin: locals.user?.is_admin ?? false,
		userName: locals.user?.name ?? ''
	};
};

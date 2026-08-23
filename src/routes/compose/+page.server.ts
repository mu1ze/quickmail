import type { PageServerLoad } from './$types';
import { getDraft } from '$lib/server/mail-store';
import { listSignatures } from '$lib/server/email-signature';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const draftId = url.searchParams.get('draft');
	const db = platform?.env.DB;

	const draft =
		draftId && db && locals.user ? await getDraft(db, locals.user.id, draftId) : null;

	const addresses = locals.addresses.filter(
		(address) => locals.domainPermissions[address.domain_id]?.can_send !== false
	);

	const signatures = locals.user && db ? await listSignatures(db, locals.user.id) : [];

	return { addresses, draft, signatures };
};

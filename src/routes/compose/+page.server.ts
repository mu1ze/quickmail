import type { PageServerLoad } from './$types';
import { getDraft, getEmailForUser } from '$lib/server/mail-store';
import { listSignatures } from '$lib/server/email-signature';
import { buildForwardBody, withForwardPrefix } from '$lib/utils/forward';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const draftId = url.searchParams.get('draft');
	const forwardId = url.searchParams.get('forward');
	const db = platform?.env.DB;

	const draft =
		draftId && db && locals.user ? await getDraft(db, locals.user.id, draftId) : null;

	const source =
		!draft && forwardId && db && locals.user
			? await getEmailForUser(db, locals.user.id, forwardId)
			: null;
	const forward =
		source && source.status !== 'draft'
			? {
					subject: withForwardPrefix(source.subject),
					html: buildForwardBody({
						from: source.from_addr,
						to: source.to_addr,
						cc: source.cc_addr,
						subject: source.subject,
						date: source.created_at,
						bodyHtml: source.body_html,
						bodyText: source.body_text
					})
				}
			: null;

	const addresses = locals.addresses.filter(
		(address) => locals.domainPermissions[address.domain_id]?.can_send !== false
	);

	const signatures = locals.user && db ? await listSignatures(db, locals.user.id) : [];

	return { addresses, draft, forward, signatures };
};

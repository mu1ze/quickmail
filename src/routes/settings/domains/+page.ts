import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Domains now live on the Addresses & domains page.
export const load: PageLoad = () => {
	redirect(308, '/settings/addresses#domains');
};

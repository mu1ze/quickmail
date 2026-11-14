import type { User } from '$lib/types';
import type { EventRow } from './calendar-store';
import { loadGroup, notifyGuests, type InviteContext } from './calendar-invites';
import { getEmailProvider } from './context';
import { listAddressesForUser } from './domains';

/**
 * Emails guests about changes to the given UIDs. Builds the mail provider only when
 * some event actually has guests, so calendars work without mail configured.
 */
export function guestMailer(platform: App.Platform, user: User, origin: string) {
	const env = { DB: platform.env.DB, ATTACHMENTS: platform.env.ATTACHMENTS };
	return async (changes: { uid: string | null; before: EventRow[] }[]): Promise<string[]> => {
		const warnings: string[] = [];
		for (const change of changes) {
			if (!change.uid) continue;
			const after = await loadGroup(env.DB, user.id, change.uid);
			const guests = [...change.before, ...after].some((row) => row.attendees !== '[]' && !row.my_email);
			if (!guests) continue;
			let ctx: InviteContext;
			try {
				ctx = { env, provider: getEmailProvider(platform), user, origin };
			} catch (error) {
				warnings.push(`Guests were not emailed: ${error instanceof Error ? error.message : 'mail sending is not set up'}`);
				continue;
			}
			warnings.push(...(await notifyGuests(ctx, change.uid, change.before, after)));
		}
		return warnings;
	};
}

/** Guests never include the user's own addresses. */
export async function withoutOwnAddresses<T extends { email: string }>(platform: App.Platform, userId: string, guests: T[]): Promise<T[]> {
	if (!guests.length) return guests;
	const own = new Set((await listAddressesForUser(platform.env.DB, userId)).map((address) => address.address.toLowerCase()));
	return guests.filter((guest) => !own.has(guest.email));
}

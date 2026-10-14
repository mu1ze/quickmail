export type SettingsLink = { href: string; label: string; icon: string };
export type SettingsGroup = { id: string; label: string; links: SettingsLink[] };

/** Settings and admin sections, grouped the same way in the desktop sidebar and the phone hub. */
export function settingsGroups(isAdmin: boolean): SettingsGroup[] {
	const groups: SettingsGroup[] = [
		{
			id: 'account',
			label: 'Account',
			links: [
				{ href: '/settings/password', label: 'Password', icon: 'lock-password-line' },
				{ href: '/settings/appearance', label: 'Appearance', icon: 'contrast-2-line' },
				{ href: '/settings/notifications', label: 'Notifications', icon: 'notification-3-line' }
			]
		},
		{
			id: 'mail',
			label: 'Mail',
			links: [
				{ href: '/settings/addresses', label: 'Addresses & domains', icon: 'at-line' },
				{ href: '/settings/signatures', label: 'Signatures', icon: 'pencil-line' },
				{ href: '/settings/automations', label: 'Automations', icon: 'flashlight-line' }
			]
		},
		{
			id: 'developer',
			label: 'Developer',
			links: [{ href: '/settings/api-keys', label: 'API keys', icon: 'key-2-line' }]
		}
	];
	if (isAdmin) {
		groups.push({
			id: 'admin',
			label: 'Admin',
			links: [
				{ href: '/admin/users', label: 'Users', icon: 'group-line' },
				{ href: '/admin/domains', label: 'Domains', icon: 'global-line' },
				{ href: '/admin/unrouted', label: 'Unrouted mail', icon: 'question-mark' }
			]
		});
	}
	return groups;
}

/** The first section, opened when /settings is visited on a wide screen. */
export const FIRST_SETTINGS_HREF = '/settings/password';

export function isSettingsLinkActive(href: string, pathname: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}

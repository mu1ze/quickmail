import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FIRST_SETTINGS_HREF, isSettingsLinkActive, settingsGroups } from './settings-nav';

describe('settings navigation', () => {
	test('admin sections only appear for admins', () => {
		assert.deepEqual(settingsGroups(false).map((group) => group.id), ['account', 'mail', 'developer']);
		assert.deepEqual(settingsGroups(true).map((group) => group.id), ['account', 'mail', 'developer', 'admin']);
	});

	test('every link is unique and the landing section is one of them', () => {
		const hrefs = settingsGroups(true).flatMap((group) => group.links.map((link) => link.href));
		assert.equal(new Set(hrefs).size, hrefs.length);
		assert.ok(hrefs.includes(FIRST_SETTINGS_HREF));
	});

	test('a section stays active on its own sub-pages only', () => {
		assert.equal(isSettingsLinkActive('/admin/users', '/admin/users'), true);
		assert.equal(isSettingsLinkActive('/admin/users', '/admin/users/42'), true);
		assert.equal(isSettingsLinkActive('/settings/password', '/settings/passwords'), false);
	});
});

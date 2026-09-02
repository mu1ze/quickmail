import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	hideDockSearch,
	hideTopbarOnMobile,
	isComposeRoute,
	isHubRoute,
	isMailboxRoute,
	resolveSearchFocusAction
} from './shell-chrome';

describe('shell chrome routing', () => {
	test('mailbox, hub, and compose routes are classified without overlap', () => {
		assert.equal(isMailboxRoute('/inbox'), true);
		assert.equal(isMailboxRoute('/settings'), false);
		assert.equal(isHubRoute('/settings'), true);
		assert.equal(isHubRoute('/settings/password'), true);
		assert.equal(isHubRoute('/admin/users'), true);
		assert.equal(isHubRoute('/inbox'), false);
		assert.equal(isComposeRoute('/compose'), true);
		assert.equal(isComposeRoute('/compose/draft-1'), true);
		assert.equal(isComposeRoute('/inbox'), false);
	});

	test('Topbar hides on mobile mailbox, hub, and compose — not on thread pages', () => {
		assert.equal(hideTopbarOnMobile('/inbox'), true);
		assert.equal(hideTopbarOnMobile('/settings'), true);
		assert.equal(hideTopbarOnMobile('/admin/domains'), true);
		assert.equal(hideTopbarOnMobile('/compose'), true);
		assert.equal(hideTopbarOnMobile('/mail/abc'), false);
		assert.equal(hideTopbarOnMobile('/onboarding'), false);
	});

	test('dock Search is hidden on settings and admin hubs', () => {
		assert.equal(hideDockSearch('/settings'), true);
		assert.equal(hideDockSearch('/admin/users'), true);
		assert.equal(hideDockSearch('/inbox'), false);
		assert.equal(hideDockSearch('/mail/abc'), false);
	});

	test('mobile hub search navigates to inbox then focuses mailbox search', () => {
		assert.equal(
			resolveSearchFocusAction({ pathname: '/settings', mobileViewport: true }),
			'inbox-then-mailbox'
		);
		assert.equal(
			resolveSearchFocusAction({ pathname: '/admin', mobileViewport: true }),
			'inbox-then-mailbox'
		);
		assert.equal(
			resolveSearchFocusAction({ pathname: '/inbox', mobileViewport: true }),
			'mailbox'
		);
		assert.equal(
			resolveSearchFocusAction({ pathname: '/settings', mobileViewport: false }),
			'topbar'
		);
		assert.equal(
			resolveSearchFocusAction({ pathname: '/mail/abc', mobileViewport: true }),
			'topbar'
		);
	});
});

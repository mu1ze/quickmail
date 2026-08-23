import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextThemePreference } from './theme';

describe('nextThemePreference', () => {
	test('cycles light → dark → system → light', () => {
		assert.equal(nextThemePreference('light'), 'dark');
		assert.equal(nextThemePreference('dark'), 'system');
		assert.equal(nextThemePreference('system'), 'light');
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseRemoteContentPreference, shouldLoadRemoteContent } from './remote-content';

describe('remote content preference', () => {
	test('is off unless explicitly enabled', () => {
		assert.equal(parseRemoteContentPreference(null), false);
		assert.equal(parseRemoteContentPreference('0'), false);
		assert.equal(parseRemoteContentPreference('maybe'), false);
		assert.equal(parseRemoteContentPreference('1'), true);
		assert.equal(parseRemoteContentPreference('true'), true);
	});

	test('the Appearance toggle loads remote content on every message', () => {
		assert.equal(shouldLoadRemoteContent(true, false), true);
		assert.equal(shouldLoadRemoteContent(true, true), true);
	});

	test('with the toggle off, only an explicit per-message opt-in loads remote content', () => {
		assert.equal(shouldLoadRemoteContent(false, false), false);
		assert.equal(shouldLoadRemoteContent(false, true), true);
	});
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseRemoteContentPreference } from './remote-content';

describe('remote content preference', () => {
	test('is off unless explicitly enabled', () => {
		assert.equal(parseRemoteContentPreference(null), false);
		assert.equal(parseRemoteContentPreference('0'), false);
		assert.equal(parseRemoteContentPreference('maybe'), false);
		assert.equal(parseRemoteContentPreference('1'), true);
		assert.equal(parseRemoteContentPreference('true'), true);
	});
});

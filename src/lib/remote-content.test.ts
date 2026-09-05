import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	parseRemoteContentPreference,
	readRemoteContentPreference,
	REMOTE_CONTENT_KEY,
	setRemoteContentPreference,
	shouldLoadRemoteContent,
	watchRemoteContentPreference
} from './remote-content';

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

	test('read/set use an in-memory cache, and a storage event from another tab updates it', () => {
		const store = new Map<string, string>();
		const target = new EventTarget();
		const storage = {
			getItem(key: string) {
				return store.has(key) ? store.get(key)! : null;
			},
			setItem(key: string, value: string) {
				store.set(key, value);
			}
		};
		Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
		Object.defineProperty(globalThis, 'window', { value: target, configurable: true });

		setRemoteContentPreference(true);
		assert.equal(readRemoteContentPreference(), true);

		storage.setItem(REMOTE_CONTENT_KEY, '0');
		assert.equal(
			readRemoteContentPreference(),
			true,
			'mutating localStorage in this tab must not bypass the cache'
		);

		const seen: boolean[] = [];
		const stop = watchRemoteContentPreference((enabled) => seen.push(enabled));
		const event = new Event('storage') as StorageEvent;
		Object.defineProperty(event, 'key', { value: REMOTE_CONTENT_KEY });
		Object.defineProperty(event, 'newValue', { value: '0' });
		target.dispatchEvent(event);
		stop();

		assert.deepEqual(seen, [false]);
		assert.equal(readRemoteContentPreference(), false);
	});
});

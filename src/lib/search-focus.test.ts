import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { onSearchFocus, requestSearchFocus, resetSearchFocus } from './search-focus';

describe('search focus bus', () => {
	test('delivers immediately when a mailbox listener is already mounted', () => {
		resetSearchFocus();
		let focused = 0;
		const stop = onSearchFocus(() => {
			focused += 1;
		});
		requestSearchFocus();
		assert.equal(focused, 1);
		stop();
	});

	test('holds a pending request until inbox search mounts after hub navigation', () => {
		resetSearchFocus();
		let focused = 0;
		requestSearchFocus();
		assert.equal(focused, 0);
		const stop = onSearchFocus(() => {
			focused += 1;
		});
		assert.equal(focused, 1);
		stop();
	});

	test('a pending request is consumed only once', () => {
		resetSearchFocus();
		requestSearchFocus();
		let first = 0;
		let second = 0;
		const stopFirst = onSearchFocus(() => {
			first += 1;
		});
		const stopSecond = onSearchFocus(() => {
			second += 1;
		});
		assert.equal(first, 1);
		assert.equal(second, 0);
		stopFirst();
		stopSecond();
	});
});

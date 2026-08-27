import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isTypingTarget, SHORTCUTS } from './shortcuts';

describe('shortcut helpers', () => {
	test('the cheat sheet stays short enough to scan', () => {
		assert.ok(SHORTCUTS.length <= 22);
		assert.ok(SHORTCUTS.some((item) => item.keys.includes('⌘K')));
		assert.ok(SHORTCUTS.some((item) => item.action.toLowerCase().includes('snooze')));
	});

	test('isTypingTarget ignores a missing target', () => {
		assert.equal(isTypingTarget(null), false);
	});
});

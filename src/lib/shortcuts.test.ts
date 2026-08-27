import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isTypingTarget, SHORTCUTS } from './shortcuts';

describe('shortcut helpers', () => {
	test('the cheat sheet stays short enough to scan', () => {
		assert.ok(SHORTCUTS.length <= 24);
		assert.ok(SHORTCUTS.some((item) => item.keys.includes('⌘K')));
		assert.ok(SHORTCUTS.some((item) => item.action.toLowerCase().includes('snooze')));
		assert.ok(SHORTCUTS.some((item) => item.keys === 'f' && item.action === 'Forward'));
		assert.ok(SHORTCUTS.some((item) => item.keys === 'p' && item.action === 'Pin to top'));
		assert.ok(SHORTCUTS.some((item) => item.keys === 's' && item.action === 'Flag'));
	});

	test('isTypingTarget ignores a missing target', () => {
		assert.equal(isTypingTarget(null), false);
	});
});

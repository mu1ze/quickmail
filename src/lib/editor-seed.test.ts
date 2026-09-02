import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { seedEditor } from './editor-seed';

describe('rich-text editor seeding', () => {
	test('empty html still marks the editor seeded so the first keystroke is not rewritten', () => {
		const editor = { innerHTML: '' };
		const seeded = seedEditor(editor, '', false);
		assert.equal(seeded, true);
		assert.equal(editor.innerHTML, '');
		editor.innerHTML = 'H';
		assert.equal(seedEditor(editor, 'H', seeded), true);
		assert.equal(editor.innerHTML, 'H');
	});

	test('draft html is copied once on mount', () => {
		const editor = { innerHTML: '' };
		const seeded = seedEditor(editor, '<p>Hello</p>', false);
		assert.equal(seeded, true);
		assert.equal(editor.innerHTML, '<p>Hello</p>');
		assert.equal(seedEditor(editor, '<p>Later</p>', seeded), true);
		assert.equal(editor.innerHTML, '<p>Hello</p>');
	});

	test('a missing node is left unseeded', () => {
		assert.equal(seedEditor(null, '<p>Hi</p>', false), false);
	});
});

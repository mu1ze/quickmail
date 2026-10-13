import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseMailSearch, searchValue } from './mail-search';

describe('mail search', () => {
	test('quoted phrases and escaped quotes survive tokenization', () => {
		const search = parseMailSearch(`subject:${searchValue('A "quoted" project')} from:alex`);
		assert.deepEqual(search.bindings, ['%A "quoted" project%', '%alex%']);
	});
	test('SQL patterns are escaped and never interpolated', () => {
		const search = parseMailSearch('from:100%_user');
		assert.deepEqual(search.bindings, ['%100\\%\\_user%']);
		assert.ok(!search.conditions.join(' ').includes('100'));
	});
	test('invalid dates and unknown operators are searched literally', () => {
		for (const term of ['after:2026-02-30', 'unknown:value', 'in:unknown']) {
			assert.equal(parseMailSearch(term).bindings[0], `%${term}%`);
		}
	});
	test('supported flags and negations need no SQL values', () => {
		const search = parseMailSearch('is:unread -has:attachment is:archived in:anywhere');
		assert.equal(search.view, 'anywhere');
		assert.equal(search.conditions.length, 3);
		assert.deepEqual(search.bindings, []);
		assert.match(search.conditions[1], /^NOT/);
	});
});

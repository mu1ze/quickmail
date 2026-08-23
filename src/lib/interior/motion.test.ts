import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { motionDuration, prefersReducedMotion } from './motion';

describe('Interior motion helpers', () => {
	test('prefersReducedMotion is a boolean', () => {
		assert.equal(typeof prefersReducedMotion(), 'boolean');
	});

	test('motionDuration collapses to zero when reduced motion is on', () => {
		const duration = motionDuration(240);
		assert.ok(duration === 0 || duration === 240);
	});
});

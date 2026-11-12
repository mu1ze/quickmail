import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MOTION_TIMING, buildShards, seededRandom, shatterProgress } from './signature-motion';
import { SIGNATURE_ANIMATIONS } from './signature-template';

const delayOf = (effect: keyof typeof MOTION_TIMING, frame: number) => {
	const { delay } = MOTION_TIMING[effect];
	return typeof delay === 'function' ? delay(frame) : delay;
};

const area = (points: [number, number][]) =>
	Math.abs(
		points[0][0] * (points[1][1] - points[2][1]) +
			points[1][0] * (points[2][1] - points[0][1]) +
			points[2][0] * (points[0][1] - points[1][1])
	) / 2;

describe('signature motion', () => {
	test('every selectable effect has baked timing', () => {
		for (const effect of SIGNATURE_ANIMATIONS) {
			if (effect === 'none') continue;
			const timing = MOTION_TIMING[effect];
			assert.ok(timing.frames >= 12 && timing.frames <= 48, `${effect} frame count`);
			for (let frame = 0; frame < timing.frames; frame++) {
				const delay = delayOf(effect, frame);
				assert.ok(Number.isFinite(delay) && delay >= 20, `${effect} frame ${frame} delay`);
			}
		}
	});

	test('effects that take the image apart rest on the intact first frame', () => {
		for (const effect of ['shatter', 'dust', 'glitch', 'flip'] as const) {
			assert.ok(delayOf(effect, 0) >= 1000, `${effect} holds its first frame`);
			assert.ok(delayOf(effect, 1) < 200, `${effect} then plays quickly`);
		}
	});

	test('shatter starts intact, scatters fully, and returns', () => {
		assert.equal(shatterProgress(0), 0);
		assert.ok(Math.abs(shatterProgress(0.42) - 1) < 1e-9);
		assert.ok(shatterProgress(0.2) > 0.5);
		assert.ok(shatterProgress(33 / 34) < 0.01);
		for (let t = 0; t < 1; t += 0.01) {
			const p = shatterProgress(t);
			assert.ok(p >= 0 && p <= 1);
		}
	});

	test('shards tile the image exactly', () => {
		for (const [w, h] of [[88, 88], [220, 36], [20, 36]] as const) {
			const shards = buildShards(w, h, 12, 10);
			assert.ok(shards.length >= 8);
			const total = shards.reduce((sum, shard) => sum + area(shard.points), 0);
			assert.ok(Math.abs(total - w * h) < 1e-6, `${w}x${h} covered once`);
			for (const shard of shards) {
				assert.ok(area(shard.points) > 0.5, 'no degenerate shard');
				for (const [x, y] of shard.points) {
					assert.ok(x >= 0 && x <= w && y >= 0 && y <= h);
				}
				assert.ok(Math.hypot(shard.dx, shard.dy) <= 10 + 1e-9, 'stays within its travel');
				assert.ok(shard.lag >= 0 && shard.lag <= 1);
			}
		}
	});

	test('fragments are the same on every render', () => {
		assert.deepEqual(buildShards(88, 88, 13, 12), buildShards(88, 88, 13, 12));
		assert.notDeepEqual(buildShards(88, 88, 13, 12, 1), buildShards(88, 88, 13, 12, 2));
		const a = seededRandom(5);
		const b = seededRandom(5);
		for (let n = 0; n < 20; n++) {
			const value = a();
			assert.equal(value, b());
			assert.ok(value >= 0 && value < 1);
		}
	});
});

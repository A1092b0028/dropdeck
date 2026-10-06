import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLevel } from '../src/services/source-meter.ts';

test('source meter derives RMS and peak from actual samples, including silence', () => {
  assert.deepEqual(sourceLevel(null), { rms: 0, peak: 0 });
  assert.deepEqual(sourceLevel(new Float32Array()), { rms: 0, peak: 0 });
  assert.deepEqual(sourceLevel(new Float32Array([0, 0])), { rms: 0, peak: 0 });
  assert.deepEqual(sourceLevel(new Float32Array([-.5, .5])), { rms: .5, peak: .5 });
  const level = sourceLevel(new Float32Array([1, 0, 0, 0]));
  assert.equal(level.rms, .5);
  assert.equal(level.peak, 1);
});

test('source meter ignores invalid samples and clamps display overflow', () => {
  assert.deepEqual(sourceLevel(new Float32Array([NaN, Infinity])), { rms: 0, peak: 0 });
  assert.deepEqual(sourceLevel(new Float32Array([2, -2])), { rms: 1, peak: 1 });
});

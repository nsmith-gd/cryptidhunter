import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSeed, stream, makeRng, getSeed } from '../src/core/rng.js';

const take = (f, n) => Array.from({ length: n }, () => f());

test('same seed gives the same sequence per stream', () => {
  setSeed(1234);
  const a = take(stream('ai'), 20), b = take(stream('clues'), 20);
  setSeed(1234);
  assert.deepEqual(take(stream('ai'), 20), a);
  assert.deepEqual(take(stream('clues'), 20), b);
  assert.equal(getSeed(), 1234);
});

test('different seeds and different streams differ', () => {
  setSeed(1); const x = take(stream('ai'), 10);
  setSeed(2); const y = take(stream('ai'), 10);
  assert.notDeepEqual(x, y);
  setSeed(1);
  assert.notDeepEqual(take(stream('ai'), 10), take(stream('clues'), 10));
});

test('streams are independent: extra rolls in one never shift another', () => {
  setSeed(99); take(stream('noisy'), 1000); const quiet = take(stream('quiet'), 10);
  setSeed(99); const alone = take(stream('quiet'), 10);
  assert.deepEqual(quiet, alone);
});

test('values are in [0, 1) and makeRng is reproducible', () => {
  const r = makeRng(7), s = makeRng(7);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); assert.equal(v, s()); }
});

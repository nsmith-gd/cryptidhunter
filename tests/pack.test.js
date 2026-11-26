import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLoad, loadEffects, packRefusal, LOAD, PACKS } from '../src/gear/pack.js';

test('worn kit alone is light: no speed or exertion penalty', () => {
  const l = computeLoad({});
  assert.ok(l.total > 4 && l.total < 6);
  assert.equal(l.speedScale, 1);
  assert.equal(l.loadFactor, 1);
});

test('a heavier load is slower and costs more stamina (monotonic)', () => {
  const light = computeLoad({ pack: { water: 1 } });
  const heavy = computeLoad({ pack: { water: 8 }, quick: { bait: 3 } });
  assert.ok(heavy.total > light.total);
  assert.ok(heavy.speedScale < light.speedScale);
  assert.ok(heavy.loadFactor > light.loadFactor);
});

test('movement speed never drops below the GDD 2.8 floor', () => {
  assert.equal(loadEffects(1000).speedScale, LOAD.speedFloor);
});

test('pack volume is separate from mass, and quick slots do not use pack volume', () => {
  const l = computeLoad({ quick: { bait: 3 }, pack: { water: 2 } });
  assert.equal(l.volume, 2);
  assert.ok(l.quickKg >= 3);
});

test('the daypack refuses items past 12 L or past the carry limit', () => {
  const full = computeLoad({ pack: { water: 12 } });
  assert.equal(full.volume, PACKS.daypack.L);
  assert.match(packRefusal(full, 'water'), /full/);
  assert.equal(packRefusal(computeLoad({ pack: { water: 4 } }), 'water'), null);
});

test('unloading helps: dropping weight restores speed', () => {
  const a = computeLoad({ pack: { water: 8, bait: 2 } });
  const b = computeLoad({ pack: { bait: 2 } });
  assert.ok(b.speedScale > a.speedScale);
});

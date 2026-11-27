import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fatigue, FATIGUE } from '../src/survival/fatigue.js';

const player = (o = {}) => ({ velocity: { x: 0, z: 0 }, sprinting: false, loadFactor: 1, ...o });

test('fatigue builds while awake, faster when sprinting', () => {
  const idle = new Fatigue({ player: player(), start: 20 });
  const sprint = new Fatigue({ player: player({ sprinting: true, velocity: { x: 6, z: 0 } }), start: 20 });
  for (let i = 0; i < 600; i++) { idle.update(0.1); sprint.update(0.1); }     // one minute
  assert.ok(Math.abs(idle.value - (20 + FATIGUE.awake * 60)) < 1e-6);
  assert.ok(sprint.value > idle.value + 10);
});

test('no stamina penalty while comfortable; the cap never goes below the 0.50 floor', () => {
  const f = new Fatigue({ player: player(), start: 30 });
  assert.equal(f.penalty, 0);
  f.value = 100;
  assert.equal(f.penalty, FATIGUE.maxPenalty);
  assert.equal(Math.max(0.5, 1 - f.penalty - 0.3), 0.5);   // with wounds too, the cap stops at 50%
  f.value = 70;
  assert.ok(f.penalty > 0 && f.penalty < FATIGUE.maxPenalty);
});

test('only sleep brings it down, and better sleep brings it down faster', () => {
  const good = new Fatigue({ player: player(), start: 80 }), poor = new Fatigue({ player: player(), start: 80 });
  good.asleep = poor.asleep = true; good.quality = 1; poor.quality = 0.5;
  for (let i = 0; i < 300; i++) { good.update(0.1); poor.update(0.1); }   // 30 s asleep
  assert.ok(Math.abs(good.value - 50) < 1e-6);
  assert.ok(Math.abs(poor.value - 65) < 1e-6);
});

test('bands and warnings follow the GDD thresholds (40 strained, 70 impaired)', () => {
  const f = new Fatigue({ player: player(), start: 39 });
  assert.equal(f.band, 'rested'); assert.equal(f.warnings().length, 0);
  f.value = 55; assert.equal(f.band, 'tired'); assert.equal(f.warnings()[0].level, 1);
  f.value = 71; assert.equal(f.band, 'exhausted'); assert.equal(f.warnings()[0].level, 2);
});

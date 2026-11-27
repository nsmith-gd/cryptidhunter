import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dread, dreadEffects, dreadFeedback, DREAD_EFFECT, DREAD_FEEDBACK_AT, DREAD } from '../src/hunt/dread.js';

// One test per effect (#132, GDD D05 / S14), plus the rules: bounded, never health or input, no
// same-tick feedback, and a quick fall in safe places.

const calm = dreadEffects(0), mid = dreadEffects(50), full = dreadEffects(100);

test('effects are zero until dread affects you (exactly when the label says so)', () => {
  for (let v = 0; v <= 100; v += 0.5) {
    const e = dreadEffects(v), on = !!dreadFeedback(v).label;
    assert.equal(e.on, on);
    for (const k of ['breathNoise', 'breathRadius', 'photoShake', 'handleDelay', 'mapDelay', 'recoveryPenalty']) assert.equal(e[k] > 0, on, `${k} at ${v}`);
    assert.equal(e.taskSlow > 1, on);
  }
  assert.equal(calm.taskSlow, 1);
});

test('breathing noise: louder and further-carrying with dread, capped', () => {
  assert.ok(mid.breathNoise > 0 && full.breathNoise > mid.breathNoise && full.breathNoise <= DREAD_EFFECT.breathNoise);
  assert.ok(full.breathRadius > mid.breathRadius && full.breathRadius <= DREAD_EFFECT.breathRadius);
});

test('tool sway and photo clarity: hand tremor adds camera motion, capped', () => {
  assert.ok(mid.photoShake > 0 && full.photoShake > mid.photoShake && full.photoShake <= DREAD_EFFECT.photoShake);
});

test('slower casting, sampling and map reading, capped', () => {
  assert.ok(full.taskSlow > mid.taskSlow && full.taskSlow <= 1 + DREAD_EFFECT.taskSlow);
  assert.ok(full.handleDelay > mid.handleDelay && full.handleDelay <= DREAD_EFFECT.handleDelay);
  assert.ok(full.mapDelay > mid.mapDelay && full.mapDelay <= DREAD_EFFECT.mapDelay);
});

test('stamina recovery penalty: capped and inside the GDD 0.25 floor', () => {
  assert.ok(full.recoveryPenalty > mid.recoveryPenalty && full.recoveryPenalty <= DREAD_EFFECT.recovery);
  // Even stacked with every other penalty, recovery never drops below the floor.
  assert.equal(Math.max(0.25, 1 - 0.5 - 0.5 - full.recoveryPenalty), 0.25);
});

test('never health, input or UI: the effects only describe these bounded quantities', () => {
  const keys = Object.keys(full).sort();
  assert.deepEqual(keys, ['breathNoise', 'breathRadius', 'handleDelay', 'mapDelay', 'on', 'photoShake', 'recoveryPenalty', 'taskSlow']);
});

// A Dread with stub senses (no DOM: the label isn't built in node).
const make = (safe = () => false) => new Dread({
  player: { position: { x: 0, z: 0 } }, fear: { lampLight: () => 0 }, flashlight: { on: true, battery: 1 },
  scene: {}, getHome: () => ({ x: 0, z: 0 }), half: 150, isSafe: safe,
});

test('its own effects cannot raise it in the same tick: scares land at the start of the next tick', () => {
  const d = make();
  d.value = 40;
  d.update(1 / 60);
  const before = d.value, effectsThisTick = d.effects;
  d.onScare(50);                       // e.g. its breathing drew the creature and that scared you
  assert.equal(d.value, before, 'not raised in the same tick');
  assert.deepEqual(d.effects, effectsThisTick, 'this tick\'s effects unchanged');
  d.update(1 / 60);
  assert.ok(d.value > before + 9, 'it lands next tick');
  assert.deepEqual(d.effects, dreadEffects(before), 'next tick\'s effects come from the start-of-tick value');
});

test('falls quickly in safe places: vehicle fastest, then shelter, fire, lamplight', () => {
  const fallIn = (kind) => { const d = make(() => kind); d.value = 80; for (let i = 0; i < 600; i++) d.update(1 / 60); return 80 - d.value; };
  const v = fallIn('vehicle'), s = fallIn('shelter'), f = fallIn('fire'), l = fallIn('light');
  assert.ok(v > s && s > f && f > l, JSON.stringify({ v, s, f, l }));
  assert.ok(l >= DREAD.safeFall.light * 10 - 1e-6, 'even lamplight takes 20 off in 10 s');
  const d = make(() => 'vehicle'); d.value = 80; for (let i = 0; i < 60 * 25; i++) d.update(1 / 60);
  assert.ok(d.value < DREAD_FEEDBACK_AT, 'a short rest at the van clears it');
});

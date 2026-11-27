// Danger & hunt failure (#89): critical cold through the health path, death losses, recovery charge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Thermoregulation, THERMO } from '../src/survival/thermoregulation.js';
import { Nutrition, NUTRITION } from '../src/survival/nutrition.js';
import { Health } from '../src/survival/health.js';
import { Ledger } from '../src/economy/ledger.js';
import { chargeRecovery, injurySeverity, gearAfter, deathReport } from '../src/hunt/failureRules.js';

const player = () => ({ position: { x: 0, y: 0, z: 0 }, sprinting: false });

test('tutorial cold never goes past its floor; ordinary cold can reach the critical band', () => {
  for (const lethal of [false, true]) {
    const t = new Thermoregulation({ player: player(), airTemp: 4, surfaceAt: () => 'deep', lethal });
    for (let i = 0; i < 3000; i++) t.update(0.5);
    if (lethal) assert.ok(t.critical && t.core < THERMO.criticalBelow, `lethal core ${t.core}`);
    else assert.ok(!t.critical && t.core >= THERMO.floor - 1e-9, `tutorial core ${t.core}`);
  }
});

test('critical cold drains health through the shared health path and ends in death, after warnings', () => {
  const h = new Health();
  let died = null; h.onDeath = (c) => { died = c; };
  const t = new Thermoregulation({ player: player(), airTemp: 4, surfaceAt: () => 'deep', lethal: true });
  let warnedAt = null, drainAt = null, s = 0;
  for (; s < 3000 && !died; s += 0.5) {
    t.update(0.5);
    if (warnedAt === null && t.warnings().some((w) => w.id === 'hypothermia')) warnedAt = s;
    h.exposure('Hypothermia', THERMO.criticalDrain, 0.5, t.critical);
    if (drainAt === null && h.value < 100) drainAt = s;
  }
  assert.equal(died, 'Hypothermia');
  assert.ok(warnedAt !== null && warnedAt < drainAt, `warned at ${warnedAt}s, health falls from ${drainAt}s`);
  assert.equal(h.conditions.filter((c) => c.kind === 'exposure').length, 1, 'one exposure condition, not a pile of hits');
});

test('getting warm again stops the drain and clears the condition', () => {
  const h = new Health();
  h.exposure('Hypothermia', 1, 5, true);
  assert.equal(h.value, 95);
  h.exposure('Hypothermia', 1, 5, false);
  assert.equal(h.value, 95);
  assert.equal(h.conditions.length, 0);
});

test('hunger is never a death on its own (GDD 9.1: no instant death from one resource)', () => {
  const n = new Nutrition({ player: player(), food: {} });
  for (let i = 0; i < 8000; i++) n.update(0.5);
  assert.equal(n.energy, NUTRITION.floor, 'energy bottoms out at its floor');
  assert.ok(!('health' in n) && !('onDeath' in n), 'nutrition has no damage path of its own');
});

test('recovery charge: 5% / 10% of the trip for moderate / severe injuries, capped at cash, once', () => {
  const l = new Ledger({ startCents: 10000 });
  const h = new Health(); h.value = 60;
  assert.equal(injurySeverity(h), 'moderate');
  const r = chargeRecovery(l, h, 2500, 'A1');
  assert.equal(r.cents, 125);
  assert.equal(chargeRecovery(l, h, 2500, 'A1').cents, 125, 'charged once per attempt');
  assert.equal(l.cash, 10000 - 125);
  const severe = new Health(); severe.value = 30;
  assert.equal(chargeRecovery(new Ledger({ startCents: 100 }), severe, 2500, 'A2').cents, 100, 'capped at the cash you have');
  assert.equal(chargeRecovery(l, new Health(), 2500, 'A3'), null, 'unhurt: no charge');
});

test('death: carried gear is lost, camp stock untouched; the report says exactly what', () => {
  assert.deepEqual(gearAfter({ bait: 5, trailCamera: 1 }, true), { bait: 0, trailCamera: 0 });
  assert.deepEqual(gearAfter({ bait: 5 }, false), { bait: 5 });
  const r = deathReport({ carried: ['Bait x5'], durable: ['Hiking boots'], rentals: ['Telephoto camera'], evidence: 2 });
  assert.match(r.text, /Bait x5/); assert.match(r.text, /Hiking boots/); assert.match(r.text, /deposit kept/);
  assert.ok(r.kept.some((k) => /banked money/.test(k)) && r.kept.some((k) => /base camp/.test(k)));
});

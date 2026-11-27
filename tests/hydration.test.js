import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hydration, HYDRATION } from '../src/survival/hydration.js';
import { Health } from '../src/survival/health.js';

const make = (o = {}) => {
  let bottles = o.bottles ?? 1;
  const player = { sprinting: false };
  const health = new Health();
  let water = 'dry';
  const h = new Hydration({ player, health, bottles: { get: () => bottles, set: (n) => { bottles = n; } }, canteen: true, tablets: o.tablets ?? 0,
    getWater: () => water, rand: () => (o.roll ?? 0), ...o.opts });
  const run = (s) => { for (let t = 0; t < s; t += 0.1) { h.update(0.1); health.update(0.1); } };
  return { h, player, health, run, setWater: (w) => { water = w; }, bottles: () => bottles };
};

test('bands match nutrition: >50 hydrated, 25-50 thirsty, <25 dehydrated; the deficit only starts below 50', () => {
  const { h } = make();
  h.value = 60; assert.equal(h.band, 'hydrated'); assert.equal(h.thirstDeficit, 0);
  h.value = 40; assert.equal(h.band, 'thirsty'); assert.ok(h.thirstDeficit > 0 && h.thirstDeficit < 0.5);
  h.value = 10; assert.equal(h.band, 'dehydrated'); assert.ok(h.thirstDeficit > 0.7);
});

test('sprinting drains it faster than walking', () => {
  const a = make(), b = make();
  b.player.sprinting = true;
  a.run(60); b.run(60);
  assert.ok(80 - b.h.value > 2.5 * (80 - a.h.value), `${a.h.value} vs ${b.h.value}`);
});

test('drinking takes a bottle first and absorbs over a few seconds, not instantly', () => {
  const { h, run, bottles } = make();
  h.value = 30;
  const r = h.drink();
  assert.equal(r.src, 'bottle');
  assert.equal(bottles(), 1 - HYDRATION.sip);
  h.update(0.1);
  assert.ok(h.value < 32, 'not instant');
  run(HYDRATION.absorbTime + 1);
  assert.ok(h.value > 30 + HYDRATION.sip * HYDRATION.perLitre * 0.8, `${h.value}`);
});

test('filling the canteen at a stream: untreated unless a tablet goes in, safe after the wait', () => {
  const { h, setWater, run } = make({ tablets: 1, bottles: 0 });
  h.canteen.litres = 0;
  setWater('shallow');
  const r = h.act();
  assert.equal(r.ok, true); assert.match(r.text, /tablet/);
  assert.equal(h.canteen.safe, false); assert.equal(h.tablets, 0);
  run(HYDRATION.purifyTime + 0.5);
  assert.equal(h.canteen.safe, true);
  setWater('dry');
  assert.equal(h.act().unsafe, false);
});

test('untreated water can make you ill, and the illness only touches health through S08 (one exposure condition)', () => {
  const { h, setWater, run, health } = make({ bottles: 0, roll: 0 });
  h.canteen.litres = 0;
  setWater('shallow'); h.act(); setWater('dry');
  const d = h.drink();
  assert.equal(d.unsafe, true);
  run(HYDRATION.illness.delay + 10);
  assert.ok(h.ill);
  assert.ok(health.value < 100);
  assert.ok(health.conditions.some((c) => c.kind === 'exposure' && c.cause === 'Unsafe water'));
  run(HYDRATION.illness.seconds + 5);
  assert.ok(!h.ill && !health.conditions.some((c) => c.cause === 'Unsafe water'), 'it passes');
  assert.ok(health.value > 70, `bounded: ${health.value}`);
});

test('warnings name the cause and the fix', () => {
  const { h } = make();
  h.value = 40;
  assert.match(h.warnings()[0].text, /Thirsty: stamina recovers slower\. Drink \(I\)/);
  h.value = 20;
  assert.match(h.warnings()[0].text, /Dehydrated: stamina recovers much slower/);
});

test('disabled (tutorial): no drain, no penalty, no warnings', () => {
  const { h, run } = make({ opts: { enabled: false } });
  run(120);
  assert.equal(h.value, HYDRATION.start);
  assert.equal(h.thirstDeficit, 0);
  assert.deepEqual(h.warnings(), []);
});

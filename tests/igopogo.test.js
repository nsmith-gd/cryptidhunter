import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IgopogoSchedule, heardAt, IGOPOGO } from '../src/cryptids/igopogo.js';
import { SURFACING, heightAt } from '../src/maps/simcoeLayout.js';

const NIGHT = 15 * 60;
const run = (seed, noiseAt = () => 0, until = NIGHT, dt = 0.5) => {
  const s = new IgopogoSchedule({ seed, zones: SURFACING });
  const pos = [];
  for (let t = 0; t <= until; t += dt) { s.update(t, (z) => noiseAt(t, z)); pos.push(s.position(t)); }
  return { s, pos };
};

test('quiet waiting: at least one surfacing window every night (many seeds)', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { s } = run(seed);
    assert.ok(s.windows.length >= 1, `seed ${seed}: ${s.windows.length} windows`);
    assert.ok(s.windows.every((w) => !w.cut && w.end - w.start >= IGOPOGO.duration[0] - 1));
  }
});

test('the schedule is seeded: same seed, same windows; another seed differs', () => {
  assert.deepEqual(run(7).s.windows, run(7).s.windows);
  assert.notDeepEqual(run(7).s.windows, run(8).s.windows);
});

test('it never leaves the water: every position is in its zone, out in the lake', () => {
  const { pos } = run(3);
  for (const p of pos) assert.ok(heightAt(p.x, p.z) < -1.5, `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) bed ${heightAt(p.x, p.z)}`);
});

test('noise on the shore while it is up makes it dive at once (window cut short)', () => {
  const quiet = run(5).s.windows[0];
  const loud = (t) => (t > quiet.start + 4 && t < quiet.start + 8 ? 0.8 : 0);
  const { s } = run(5, loud);
  const w = s.windows[0];
  assert.equal(w.start, quiet.start);
  assert.ok(w.cut && w.end < quiet.end && w.end - w.start < 9, JSON.stringify(w));
  assert.ok(s.trace.some((e) => e.type === 'withdraw'));
});

test('noise just before a rise calls the window off and it rests longer', () => {
  const quiet = run(9).s.windows[0];
  const loud = (t) => (t > quiet.start - 10 && t < quiet.start ? 0.8 : 0);
  const { s } = run(9, loud);
  assert.ok(s.trace.some((e) => e.type === 'cancel'));
  assert.ok(!s.windows.length || s.windows[0].start > quiet.start + IGOPOGO.wary[0], JSON.stringify(s.windows[0]));
});

test('noise is heard over water: loud and close counts, a quiet step far off does not', () => {
  const z = { x: 0, z: -40, r: 6 };
  assert.ok(heardAt(z, { x: 0, z: -20, level: 1, radius: 20 }) > IGOPOGO.diveNoise);   // sprinting on the beach 14 m off
  assert.equal(heardAt(z, { x: 0, z: 40, level: 0.15, radius: 3 }), 0);                // crouched, 74 m away
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScentField, SCENT } from '../src/cryptids/scent.js';
import { RoutineMemory, ROUTINE } from '../src/cryptids/routine.js';

test('a trace carries downwind, not upwind', () => {
  const f = new ScentField({ wind: { x: 1, z: 0, speed: 1.5 } });   // blowing toward +x
  f.emit('food', 0, 0);
  assert.ok(f.smell(25, 0).level > 0.1, 'downwind at 25 m');
  assert.equal(f.smell(-25, 0), null, 'upwind at 25 m');
  assert.ok(f.smell(-1, 0).level > 0, 'right next to it, any side');
  assert.ok((f.smell(25, 15)?.level ?? 0) < f.smell(25, 0).level, 'off the plume axis is weaker');
});

test('traces fade with age and are dropped', () => {
  const f = new ScentField();
  const t = f.emit('food', 0, 0);
  const fresh = f.strengthOf(t);
  f.update(SCENT.kinds.food.halfLife);
  assert.ok(Math.abs(f.strengthOf(t) - fresh / 2) < 1e-9);
  f.update(10000);
  assert.equal(f.traces.length, 0);
});

test('routine: bounded confidence that grows with repeated sightings and expires', () => {
  const r = new RoutineMemory();
  for (let i = 0; i < 10; i++) r.observe('route', 10 + i * 0.1, 5, 'seen');
  assert.equal(r.spots.length, 1);
  assert.ok(r.confidenceOf(r.spots[0]) <= 1);
  assert.ok(r.anticipate(10, 5).confidence > 0.9);
  r.update(ROUTINE.ttl.seen + 1);
  assert.equal(r.anticipate(10, 5), null);
});

test('a route it never saw (and left no trace on) cannot be anticipated', () => {
  const r = new RoutineMemory();
  r.observe('route', 0, 0, 'seen');
  assert.ok(r.anticipate(0, 0));
  assert.equal(r.anticipate(60, 60), null);
});

test('inferred from a trace counts less than seen', () => {
  const a = new RoutineMemory(), b = new RoutineMemory();
  a.observe('food', 0, 0, 'seen'); b.observe('food', 0, 0, 'trace');
  assert.ok(a.anticipate(0, 0).confidence > b.anticipate(0, 0).confidence);
});

// ---- #143 trails ---------------------------------------------------------------------------------
import { ScentTracker } from '../src/cryptids/scent.js';

// A wounded walk: a blood drop every 4 m along an L (east 30 m, then north 30 m), one every 3 s.
function lTrail(field, { from = 0, to = 15, wetX = null } = {}) {
  const pts = [];
  for (let i = 0; i <= 7; i++) pts.push({ x: i * 4, z: 0 });
  for (let i = 1; i <= 7; i++) pts.push({ x: 28, z: -i * 4 });
  for (const [i, p] of pts.entries()) {
    if (i < from || i > to) continue;
    field.emit('blood', p.x, p.z, { strength: 0.5, source: 'player' });
    field.update(3);
  }
  return pts;
}
const walk = (tr, pos, steps = 2000, speed = 3, dt = 0.1) => {
  const trail = [];
  for (let i = 0; i < steps && tr.state !== 'lost'; i++) {
    tr.update(pos.x, pos.z, dt);
    const w = tr.waypoint();
    if (w) { const d = Math.hypot(w.x - pos.x, w.z - pos.z), k = Math.min(1, (speed * dt) / (d || 1)); pos.x += (w.x - pos.x) * k; pos.z += (w.z - pos.z) * k; trail.push({ ...pos }); }
  }
  return trail;
};

test('trail: each trace leads to the nearest fresher one; the fresh end leads nowhere', () => {
  const f = new ScentField({ wind: { x: 1, z: 0, speed: 1 } });
  lTrail(f);
  const first = f.traces[0];
  const seq = [first];
  for (let t = f.trailNext(first); t; t = f.trailNext(t)) seq.push(t);
  assert.equal(seq.length, f.traces.length);
  assert.ok(seq.every((t, i) => i === 0 || t.born > seq[i - 1].born));
});

test('a tracker that strikes the old end follows the actual route, round the corner, not a beeline', () => {
  const f = new ScentField({ wind: { x: -1, z: 0, speed: 1 } });   // wind blows west, toward the creature
  const pts = lTrail(f);
  const tr = new ScentTracker(f);
  const pos = { x: -6, z: 0 };                                      // just west of where the trail starts
  const path = walk(tr, pos);
  assert.ok(tr.path.length >= 12, `checked ${tr.path.length} drops`);
  const corner = pts[7];
  assert.ok(path.some((p) => Math.hypot(p.x - corner.x, p.z - corner.z) < 1.6), 'went round the corner');
  assert.ok(Math.hypot(pos.x - pts.at(-1).x, pos.z - pts.at(-1).z) < 2, 'ended at the fresh end');
  assert.equal(tr.state, 'lost');                                   // nothing fresher: it casts about and gives up
});

test('a break in the trail (bandaged, then bleeding again later, 12 m on) stops the tracker at the break', () => {
  const f = new ScentField({ wind: { x: -1, z: 0, speed: 1 } });
  lTrail(f, { to: 6 });
  f.update(10);
  f.emit('blood', 28, -16, { strength: 0.5 }); f.update(3); f.emit('blood', 28, -20, { strength: 0.5 });
  const tr = new ScentTracker(f);
  const pos = { x: -6, z: 0 };
  walk(tr, pos);
  assert.ok(Math.hypot(pos.x - 24, pos.z) < 2, `stopped at the break, at ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`);
  assert.ok(tr.log.some((e) => /trail ends/.test(e.what)));
});

test('scent landing in water is carried off: wading across a creek breaks the trail', () => {
  const f = new ScentField({ isWet: (x) => x > 10 && x < 20 });
  lTrail(f);
  assert.ok(f.traces.every((t) => !(t.x > 10 && t.x < 20)));
  assert.ok(f.log.some((e) => e.washed));
  assert.equal(f.trailNext(f.traces.find((t) => t.x === 8)), null);   // 8 -> 20: 12 m gap
});

test('a carcass keeps smelling while it lies there; removing it stops new scent', () => {
  const f = new ScentField();
  const id = f.addSource({ kind: 'carcass', x: 5, z: 5, every: 30 });
  f.update(300);
  assert.ok(f.traces.some((t) => t.kind === 'carcass' && f.strengthOf(t) > 0.8));
  f.removeSource(id);
  f.update(3000);
  assert.ok(!f.traces.some((t) => t.kind === 'carcass' && f.strengthOf(t) > 0.5));
});

test('nothing in the world, nothing to follow: sealed food in a pack is invisible to the tracker', () => {
  const f = new ScentField();
  const tr = new ScentTracker(f);
  const pack = { food: 3, sealed: true };                            // the tracker has no way to read this
  for (let i = 0; i < 100; i++) tr.update(0, 0, 0.5);
  assert.equal(tr.state, 'idle');
  assert.ok(pack.food === 3);
});

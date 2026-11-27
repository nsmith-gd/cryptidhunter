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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InterferenceField, strengthAt, INTERFERENCE } from '../src/power/interference.js';

const src = { x: 0, y: 0, z: 0 };
const run = (field, devices, seconds, dt = 0.1) => { let s; for (let t = 0; t < seconds; t += dt) s = field.update(dt, devices); return s; };

test('strength: full inside, fading to nothing at the outer radius', () => {
  assert.equal(strengthAt(src, { x: 5, z: 0 }), 1);
  assert.equal(strengthAt(src, { x: 40, z: 0 }), 0);
  const mid = strengthAt(src, { x: 19, z: 0 });
  assert.ok(mid > 0.2 && mid < 0.8, `${mid}`);
});

test('powered devices near the creature degrade and fail; analogue tools are untouched', () => {
  const f = new InterferenceField({ sources: () => [src] });
  const at = { x: 4, z: 0 };
  const s = run(f, [{ id: 'torch', kind: 'torch', ...at }, { id: 'nvg', kind: 'nightVision', ...at }, { id: 'map', kind: 'paperMap', ...at }, { id: 'film', kind: 'filmCamera', ...at }], 1);
  assert.equal(s.get('torch'), 'failed');
  assert.equal(s.get('nvg'), 'failed');
  assert.equal(s.get('map'), 'ok');
  assert.equal(s.get('film'), 'ok');
});

test('at the edge of the field a torch flickers (irregular dropouts) before it fails', () => {
  const f = new InterferenceField({ sources: () => [src] });
  let d = 29;
  const seen = new Set();
  for (; d > 3; d -= 0.5) { seen.add(f.update(0.1, [{ id: 'torch', kind: 'torch', x: d, z: 0 }]).get('torch')); }
  assert.deepEqual([...seen], ['ok', 'flicker', 'failed']);
  let on = 0; for (let i = 0; i < 200; i++) { f.time += 0.05; on += f.flickerOn('torch', 0.4) ? 1 : 0; }
  assert.ok(on > 20 && on < 180, `on ${on}/200`);
});

test('no global shutdown: a device out of range keeps working while one in range fails', () => {
  const f = new InterferenceField({ sources: () => [src] });
  const s = run(f, [{ id: 'cam1', kind: 'trailCam', x: 3, z: 0 }, { id: 'cam2', kind: 'trailCam', x: 80, z: 0 }], 1);
  assert.equal(s.get('cam1'), 'failed');
  assert.equal(s.get('cam2'), 'ok');
});

test('walking out of range restores the devices (after a short recovery)', () => {
  const f = new InterferenceField({ sources: () => [src] });
  run(f, [{ id: 'torch', kind: 'torch', x: 2, z: 0 }], 1);
  let s = run(f, [{ id: 'torch', kind: 'torch', x: 50, z: 0 }], INTERFERENCE.recover * 0.5);
  assert.equal(s.get('torch'), 'failed', 'not instantly');
  s = run(f, [{ id: 'torch', kind: 'torch', x: 50, z: 0 }], INTERFERENCE.recover);
  assert.equal(s.get('torch'), 'ok');
  assert.deepEqual(f.trace.map((e) => e.to), ['failed', 'ok']);
});

test('no creature around, no interference', () => {
  const f = new InterferenceField({ sources: () => [] });
  assert.equal(run(f, [{ id: 'torch', kind: 'torch', x: 0, z: 0 }], 1).get('torch'), 'ok');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageGraph, CoverGraph, segmentHitsBox } from '../src/security/coverage.js';

const box = (x, z, w, d, h = 4) => ({ min: { x: x - w / 2, y: 0, z: z - d / 2 }, max: { x: x + w / 2, y: h, z: z + d / 2 } });
const cam = (id, x, z, heading, extra = {}) => ({ id, x, y: 2, z, heading, fov: 0.35, range: 30, ...extra });
const P = (x, z) => ({ x, y: 1.4, z });

test('segment vs box: blocked through the middle, clear past it, clear from inside', () => {
  const b = box(0, 5, 2, 2);
  assert.ok(segmentHitsBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, b));
  assert.ok(!segmentHitsBox({ x: 3, y: 1, z: 0 }, { x: 3, y: 1, z: 10 }, b));
  assert.ok(!segmentHitsBox({ x: 0, y: 1, z: 5 }, { x: 0, y: 1, z: 10 }, b));
});

test('a powered, unoccluded camera covers what is in its field of view and range, nothing else', () => {
  const g = new CoverageGraph({ nodes: [cam('A', 0, 0, 0)] });           // looking along +z
  assert.deepEqual(g.camerasSeeing(P(0, 20)), ['A']);
  assert.deepEqual(g.camerasSeeing(P(0, 40)), []);                       // out of range
  assert.deepEqual(g.camerasSeeing(P(20, 5)), []);                       // outside its field of view
});

test('unpowered, removed or occluded nodes give no coverage', () => {
  let on = true;
  const nodes = [cam('A', 0, 0, 0)];
  const g = new CoverageGraph({ nodes, powered: () => on, occluders: [box(10, 12, 2, 2)] });
  on = false; assert.deepEqual(g.camerasSeeing(P(0, 20)), []);
  on = true; nodes[0].removed = true; assert.deepEqual(g.camerasSeeing(P(0, 20)), []);
  nodes[0].removed = false;
  const g2 = new CoverageGraph({ nodes: [cam('B', 10, 0, 0)], occluders: [box(10, 12, 2, 2)] });
  assert.deepEqual(g2.camerasSeeing(P(10, 20)), []);                     // the rock is in the way
});

test('direct vision counts; asleep, it does not', () => {
  const g = new CoverageGraph();
  const you = { x: 0, y: 1.6, z: 0, forward: { x: 0, z: 1 }, fov: 1, range: 32, awake: true };
  assert.ok(g.watched(P(0, 15), [you]));
  assert.ok(!g.watched(P(0, -15), [you]));                               // behind you
  assert.ok(!g.watched(P(0, 15), [{ ...you, awake: false }]));
});

// Cover graph: two parallel corridors to a camp, joined at the far end.
const nodes = { s: { x: 0, z: -30 }, w1: { x: -10, z: -20 }, w2: { x: -10, z: -10 }, w3: { x: -10, z: 0 }, e1: { x: 10, z: -20 }, e2: { x: 10, z: -10 }, e3: { x: 10, z: 0 }, camp: { x: 0, z: 10 } };
const edges = [['s', 'w1'], ['w1', 'w2'], ['w2', 'w3'], ['w3', 'camp'], ['s', 'e1'], ['e1', 'e2'], ['e2', 'e3'], ['e3', 'camp']];

test('the Hidebehind only steps to a neighbour, along an unwatched edge; watched everywhere, it waits', () => {
  const cg = new CoverGraph({ nodes, edges });
  const g = new CoverageGraph({ nodes: [cam('W', -10, 8, Math.PI, { fov: 0.3 }), cam('E', 10, 8, Math.PI, { fov: 0.3 })] });   // both corridors watched
  const ew = (a, b) => g.edgeWatched(a, b);
  assert.equal(cg.nextStep('s', 'camp', ew), null);
  const g1 = new CoverageGraph({ nodes: [cam('W', -10, 8, Math.PI, { fov: 0.3 })] });                                           // east corridor open
  const ew1 = (a, b) => g1.edgeWatched(a, b);
  let at = 's'; const path = [at];
  for (let i = 0; i < 10 && at !== 'camp'; i++) { const n = cg.nextStep(at, 'camp', ew1); if (!n) break; assert.ok(cg.neighbours(at).includes(n)); assert.ok(!ew1(nodes[at], nodes[n])); at = n; path.push(at); }
  assert.deepEqual(path, ['s', 'e1', 'e2', 'e3', 'camp']);
});

test('property: over many random camera setups it never crosses a watched edge and never teleports', () => {
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cg = new CoverGraph({ nodes, edges });
  for (let k = 0; k < 200; k++) {
    const cams = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => cam(`c${i}`, (r() * 2 - 1) * 20, (r() * 2 - 1) * 20, r() * Math.PI * 2, { fov: 0.2 + r() * 0.5, range: 10 + r() * 25, removed: r() < 0.2 }));
    const on = r() > 0.1;
    const g = new CoverageGraph({ nodes: cams, powered: () => on, occluders: [box((r() * 2 - 1) * 15, (r() * 2 - 1) * 15, 3, 3)] });
    const ew = (a, b) => g.edgeWatched(a, b);
    let at = 's';
    for (let i = 0; i < 12; i++) {
      const n = cg.nextStep(at, 'camp', ew);
      if (!n) break;
      assert.ok(cg.neighbours(at).includes(n), 'adjacent only');
      assert.ok(!ew(nodes[at], nodes[n]), 'never along a watched edge');
      at = n;
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLandmarks, beside, LANDMARKS } from '../src/maps/forestLandmarks.js';

// Same landmark points as Pine Hollow (maps/forest.js).
const L = {
  trailhead: { x: 0, z: 132 }, fork: { x: 0, z: 100 }, cabin: { x: -45, z: 68 }, campsite: { x: 78, z: 82 },
  footbridge: { x: 35, z: 20 }, boulders: { x: -88, z: -32 }, ridgePass: { x: 19, z: -62 }, westNotch: { x: -123, z: -62 },
  lookout: { x: 70, z: -88 }, hollow: { x: -5, z: -112 },
};
const TRAILS = [
  [L.trailhead, L.fork, { x: -20, z: 86 }, L.cabin],
  [L.fork, { x: 30, z: 70 }, { x: 40, z: 45 }, L.footbridge, { x: 30, z: -10 }, { x: 22, z: -40 }, L.ridgePass, { x: 14, z: -85 }, L.hollow],
  [{ x: 30, z: 70 }, { x: 55, z: 80 }, L.campsite],
  [{ x: 22, z: -40 }, { x: -40, z: -30 }, L.boulders, { x: -118, z: -40 }, L.westNotch, { x: -110, z: -95 }, { x: -45, z: -115 }, L.hollow],
  [{ x: 14, z: -85 }, { x: 45, z: -92 }, L.lookout],
  [L.cabin, { x: -70, z: 40 }, { x: -80, z: 5 }],
];
const segDist = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
};
const trailDist = (p) => Math.min(...TRAILS.flatMap((t) => t.slice(1).map((b, i) => segDist(p.x, p.z, t[i], b))));

test('beside() offsets to the left of travel', () => {
  const p = beside({ x: 0, z: 0 }, { x: 0, z: -10 }, 0.5, 2); // travelling north (-z): left is west (-x)
  assert.ok(Math.abs(p.z + 5) < 1e-9);
  assert.ok(Math.abs(Math.abs(p.x) - 2) < 1e-9);
});

test('props sit beside the trails, never on the tread, and inside the fence', () => {
  const plan = planLandmarks(L, 150);
  for (const [name, p] of Object.entries(plan.spots)) {
    if (['bedding', 'teepee2'].includes(name)) continue; // in the hollow clearing on purpose
    assert.ok(trailDist(p) > 3.2, `${name} is ${trailDist(p).toFixed(1)} m from a trail`);
    assert.ok(trailDist(p) < 9, `${name} should be visible from a trail`);
  }
  for (const p of Object.values(plan.spots)) assert.ok(Math.abs(p.x) < plan.fence && Math.abs(p.z) < plan.fence);
  assert.equal(plan.fence, 150 - LANDMARKS.fenceInset);
});

test('the start, van and every landmark are inside the boundary fence', () => {
  const plan = planLandmarks(L, 150);
  for (const p of [...Object.values(L), { x: 9, z: 137 }]) assert.ok(Math.abs(p.x) < plan.fence - 1 && Math.abs(p.z) < plan.fence - 1);
});

test('puddles lie on the trails (in the ruts) or in the hollow', () => {
  const plan = planLandmarks(L, 150);
  for (const p of plan.puddles) {
    const inHollow = Math.hypot(p.x - L.hollow.x, p.z - L.hollow.z) < 16;
    assert.ok(inHollow || trailDist(p) < 1.5, `puddle at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  }
});

test('the tree-stand steps are low enough to walk up', () => {
  assert.ok(LANDMARKS.stand.rise <= 0.36);
  assert.ok(Math.ceil(LANDMARKS.stand.height / LANDMARKS.stand.rise) * LANDMARKS.stand.rise >= LANDMARKS.stand.height);
});

test('traces get closer to the hollow the further north you go (risk gradient)', () => {
  const { spots: s } = planLandmarks(L, 150);
  const d = (p) => Math.hypot(p.x - L.hollow.x, p.z - L.hollow.z);
  assert.ok(d(s.sapling1) > d(s.scratchTree) && d(s.scratchTree) > d(s.xArch) && d(s.xArch) > d(s.bedding));
});

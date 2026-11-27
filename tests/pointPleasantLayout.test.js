import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PP, JUNCTIONS, ROAD_LINES, OVERLOOKS, LANDMARKS, EXIT, SIGNS, heightAt, planTrees, landmarksSeenFrom, reachableFrom, lineOfSight } from '../src/maps/pointPleasantLayout.js';

const opts = { trees: planTrees() };

test('stable paths: every junction, both overlooks and the gate are on one connected road network', () => {
  assert.equal(reachableFrom('gate').size, Object.keys(JUNCTIONS).length);
});

test('readable landmarks for manual navigation: one is in sight from every junction and most of the road', () => {
  for (const [id, p] of Object.entries(JUNCTIONS)) assert.ok(landmarksSeenFrom(p, opts).length >= 1, `${id} sees nothing`);
  let n = 0, seen = 0;
  for (const [a, b] of ROAD_LINES) {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= L; d += 10) { const p = { x: a.x + (b.x - a.x) * d / L, z: a.z + (b.z - a.z) * d / L }; n++; if (landmarksSeenFrom(p, opts).length) seen++; }
  }
  assert.ok(seen / n >= 0.8, `${seen}/${n}`);
  for (const l of LANDMARKS) assert.ok(l.height > PP.treeTop + 5, `${l.id} stands over the trees`);
});

test('overlooks: raised bare tops that see the landmarks and several junction yards', () => {
  for (const o of OVERLOOKS) {
    assert.ok(heightAt(o.x, o.z) > 7, `${o.id} height`);
    assert.ok(landmarksSeenFrom(o, opts).length >= 2, `${o.id} landmarks`);
    const yards = Object.values(JUNCTIONS).filter((j) => lineOfSight({ x: o.x, y: heightAt(o.x, o.z) + 1.6, z: o.z }, { x: j.x, y: heightAt(j.x, j.z) + 1, z: j.z }, opts)).length;
    assert.ok(yards >= 2, `${o.id} sees ${yards} junctions`);
  }
});

test('a marked road exit: Route 62 leaves through the gate at the map edge, signposted from every junction', () => {
  assert.ok(EXIT.z > PP.half - 8);
  assert.equal(EXIT.gate, JUNCTIONS.gate);
  assert.equal(SIGNS.length, Object.keys(JUNCTIONS).length - 2);
  assert.ok(SIGNS.every((s) => s.boards.length >= 1));
});

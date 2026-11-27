import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIMCOE, CAMPS, OBSERVATION, SURFACING, TRAILS, ROAD, EXIT, heightAt, isDry, shoreZ, planTrees, visibilityReport, viewDistance, lineOfSight } from '../src/maps/simcoeLayout.js';

test('two sheltered camp spots and one exposed, all on dry land', () => {
  assert.equal(CAMPS.filter((c) => c.sheltered).length, 2);
  assert.equal(CAMPS.filter((c) => !c.sheltered).length, 1);
  for (const c of CAMPS) assert.ok(isDry(c.x, c.z), `${c.name} dry`);
});

test('sheltered camps have something between them and the lake; the exposed one does not', () => {
  const trees = planTrees();
  for (const c of CAMPS) {
    const from = { x: c.x, y: heightAt(c.x, c.z) + 1, z: c.z }, to = { x: c.x, y: 1, z: shoreZ(c.x) - 15 };
    assert.equal(lineOfSight(from, to, { trees }), !c.sheltered, `${c.name}: lake wind ${c.sheltered ? 'blocked' : 'open'}`);
  }
});

test('the Point has a long view over the lake (100 m+)', () => {
  const p = OBSERVATION.find((o) => o.longView);
  assert.ok(p && isDry(p.x, p.z));
  assert.ok(heightAt(p.x, p.z) > 4, `bluff height ${heightAt(p.x, p.z)}`);
  assert.ok(viewDistance(p) >= 100, `view ${viewDistance(p)}`);
});

test('every surfacing zone is out in the water and visible from at least one dry observation point', () => {
  for (const s of SURFACING) assert.ok(heightAt(s.x, s.z) < -2, `${s.id} in deep water`);
  const report = visibilityReport();
  for (const r of report) assert.ok(r.seenFrom.length >= 1, `${r.id} seen from ${r.seenFrom}`);
});

test('trails are closed loops and the road leads from the map edge to the exit', () => {
  for (const k of ['shoreLoop', 'woodsLoop']) {
    const t = TRAILS[k];
    assert.deepEqual(t[0], t.at(-1), `${k} closes`);
  }
  assert.ok(Math.max(Math.abs(ROAD[0].x), Math.abs(ROAD[0].z)) >= SIMCOE.half, 'road starts at the boundary');
  assert.deepEqual({ x: ROAD.at(-1).x, z: ROAD.at(-1).z }, { x: EXIT.x, z: EXIT.z });
  assert.ok(isDry(EXIT.x, EXIT.z));
});

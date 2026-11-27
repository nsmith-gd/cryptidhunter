import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OZARK, ROUTES, CAMPS, EXIT, JUNCTION, ROAD, heightAt, slopeAt, inCreek, routeLength, coverFraction, sample, planTrees, planCliffs, creekZ } from '../src/maps/ozarkLayout.js';

const trees = planTrees();
const openMetres = (pts) => sample(pts, 2).filter((p) => !trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 6)).length * 2;

test('steep ridges and a valley: ridges stand 14 m+ over the creek, with flanks steeper than 1 in 1', () => {
  const creek = heightAt(0, creekZ(0));
  assert.ok(heightAt(-10, -50) - creek > 14, 'Bald Knob');
  assert.ok(heightAt(-12, 45) - creek > 12, 'Pine Ridge');
  let steep = 0;
  for (let x = -90; x < 90; x += 5) for (let z = -90; z < 90; z += 5) if (slopeAt(x, z) > 1) steep++;
  assert.ok(steep > 10, `steep cells ${steep}`);
});

test('several camp positions (4), on dry, fairly level ground; one is exposed on a crest', () => {
  assert.ok(CAMPS.length >= 3);
  for (const c of CAMPS) {
    assert.ok(!inCreek(c.x, c.z), `${c.name} out of the creek`);
    assert.ok(slopeAt(c.x, c.z) < 0.3, `${c.name} slope ${slopeAt(c.x, c.z).toFixed(2)}`);
  }
  assert.ok(CAMPS.some((c) => !c.sheltered) && CAMPS.filter((c) => c.sheltered).length >= 2);
});

test('two routes home from the valley to the trailhead: a shorter exposed one and a longer sheltered one', () => {
  const { bald, gap } = ROUTES;
  for (const r of [bald, gap]) {
    assert.deepEqual(r.pts[0], JUNCTION);
    assert.deepEqual({ x: r.pts.at(-1).x, z: r.pts.at(-1).z }, { x: EXIT.x, z: EXIT.z });
  }
  const lb = routeLength(bald.pts), lg = routeLength(gap.pts);
  assert.ok(lb < lg * 0.7, `bald ${lb.toFixed(0)} m vs gap ${lg.toFixed(0)} m`);
  assert.ok(bald.exposed && !gap.exposed);
  assert.ok(openMetres(bald.pts) >= 50, `bald open ground ${openMetres(bald.pts)} m`);
  assert.ok(coverFraction(gap.pts, trees) >= 0.75, `gap cover ${coverFraction(gap.pts, trees).toFixed(2)}`);
  // The short way climbs much higher and steeper.
  const top = (pts) => Math.max(...sample(pts, 1).map((p) => p.y)), steep = (pts) => Math.max(...sample(pts, 1).map((p) => slopeAt(p.x, p.z)));
  assert.ok(top(bald.pts) > top(gap.pts) + 8 && steep(bald.pts) > 1 && steep(gap.pts) < 0.5);
});

test('no cliff band blocks either route, and the road reaches the map edge', () => {
  const cliffs = planCliffs();
  for (const r of Object.values(ROUTES)) {
    const hit = cliffs.filter((b) => sample(r.pts, 0.5).some((p) => Math.abs(p.x - b.x) < b.w / 2 + 0.6 && Math.abs(p.z - b.z) < b.d / 2 + 0.6));
    assert.equal(hit.length, 0, r.name);
  }
  assert.ok(Math.max(Math.abs(ROAD[0].x), Math.abs(ROAD[0].z)) >= OZARK.half);
});

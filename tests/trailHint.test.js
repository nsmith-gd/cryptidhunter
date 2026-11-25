import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassName, pointAhead, nearestIndex, clueHint, freshness } from '../src/clues/trailHint.js';

test('compass convention: north is -Z, east is +X', () => {
  assert.equal(compassName(0, -1), 'north');
  assert.equal(compassName(1, 0), 'east');
  assert.equal(compassName(0, 1), 'south');
  assert.equal(compassName(-1, -1), 'north-west');
});

// An L-shaped route: 20 m north, then 20 m east (0.5 m steps like the recorded path).
const route = [];
for (let z = 0; z >= -20; z -= 0.5) route.push({ x: 0, z });
for (let x = 0.5; x <= 20; x += 0.5) route.push({ x, z: -20 });

test('pointAhead walks along the route and stops at its end', () => {
  assert.deepEqual(pointAhead(route, 0, 10), { x: 0, z: -10 });
  const p = pointAhead(route, 20, 15); // from (0,-10): 10 north then 5 east
  assert.ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.z + 20) < 1e-9);
  assert.deepEqual(pointAhead(route, route.length - 3, 50), route[route.length - 1]);
  assert.equal(nearestIndex(route, 0.2, -10.1), 20);
});

test('hint names freshness and the way the cryptid went from the clue', () => {
  const old = { type: 'footprint', age: 200, origin: { x: 0, z: -2 } };
  assert.equal(clueHint(old, pointAhead(route, 4, 15)), 'Old footprint, heading north.');
  const corner = { type: 'hair', age: 10, origin: { x: 0, z: -15 } };
  assert.equal(clueHint(corner, pointAhead(route, 30, 15)), 'Very fresh hair, heading north-east.');
  const atEnd = { type: 'scratch', age: 5, origin: { x: 20, z: -20 } };
  assert.match(clueHint(atEnd, route[route.length - 1]), /It's close\./);
  assert.deepEqual([5, 60, 120, 400].map(freshness), ['Very fresh', 'Fresh', 'A few minutes old', 'Old']);
});

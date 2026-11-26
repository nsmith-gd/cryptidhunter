import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSigns } from '../src/maps/trailSigns.js';

// A small network: parking -> fork; fork -> cabin (west) and fork -> bridge -> lookout (north).
const P = { parking: { x: 0, z: 100 }, fork: { x: 0, z: 60 }, cabin: { x: -50, z: 60 }, bridge: { x: 0, z: 20 }, lookout: { x: 30, z: -30 } };
const trails = [[P.parking, P.fork, P.cabin], [P.fork, { x: 5, z: 40 }, P.bridge, P.lookout]];
const places = [
  { id: 'parking', name: 'Parking', ...P.parking }, { id: 'cabin', name: 'Cabin', ...P.cabin },
  { id: 'bridge', name: 'Bridge', ...P.bridge }, { id: 'lookout', name: 'Lookout', ...P.lookout },
];

test('a sign stands at the junction, one board per branch', () => {
  const signs = layoutSigns(trails, places, 'parking');
  const fork = signs.find((s) => s.x === 0 && s.z === 60);
  assert.ok(fork);
  assert.equal(fork.boards.length, 3);
});

test('the board pointing back toward the parking names it, with the trail distance', () => {
  const signs = layoutSigns(trails, places, 'parking');
  const bridge = signs.find((s) => s.here === 'Bridge');
  const home = bridge.boards.find((b) => b.home);
  assert.ok(home);
  const parking = home.lines.find((l) => l.name === 'Parking');
  assert.ok(parking, JSON.stringify(home.lines));
  assert.ok(Math.abs(parking.m - (Math.hypot(5, 20) + Math.hypot(5, 20) + 40)) < 1e-6);
});

test('following only the home arrows from any sign reaches the parking', () => {
  const signs = layoutSigns(trails, places, 'parking');
  for (const start of signs) {
    let s = start, guard = 0;
    while (guard++ < 10) {
      const b = s.boards.find((x) => x.home);
      if (!b) break;
      // Walk to the next sign or place down that branch.
      let prev = s, cur = b.toward;
      while (!signs.find((x) => x.x === cur.x && x.z === cur.z) && !(cur.x === 0 && cur.z === 100)) {
        const next = cur.edges.map((e) => e.to).find((n) => n.x !== prev.x || n.z !== prev.z);
        prev = cur; cur = next;
      }
      if (cur.x === 0 && cur.z === 100) { s = null; break; }
      s = signs.find((x) => x.x === cur.x && x.z === cur.z);
    }
    assert.equal(s, null, `from ${start.here ?? `${start.x},${start.z}`}`);
  }
});

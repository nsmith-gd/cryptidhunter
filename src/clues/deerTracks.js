import { stream } from '../core/rng.js';

// Ordinary-animal false leads (GDD 4.4): a few deer have wandered through the woods, leaving
// small split-hoof prints. They look like a trail at a glance; up close (or examined) they're
// clearly just deer, and no buyer pays for them. Seeded, so a given world always has the same ones.
export const DEER = {
  trails: 4,            // how many deer trails per map
  length: [35, 70],     // metres each one wanders
  stride: 0.9,          // metres between prints
  turn: 0.35,           // radians of wander per stride
};

/**
 * Lay deer trails on the map. blocked(x, z) -> true inside trees/rocks; bounds: half map size.
 * avoid: [{ x, z, r }] places to keep clear (spawn, van). Returns the trails' print positions.
 */
export function spawnDeerTracks({ clues, bounds, blocked = () => false, avoid = [], rand = stream('deer') }) {
  const trails = [];
  for (let t = 0; t < DEER.trails; t++) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      x = (rand() * 2 - 1) * (bounds - 12); z = (rand() * 2 - 1) * (bounds - 12);
      ok = !blocked(x, z) && avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r);
    }
    if (!ok) continue;
    let h = rand() * Math.PI * 2, left = true;
    const len = DEER.length[0] + rand() * (DEER.length[1] - DEER.length[0]);
    const prints = [];
    for (let d = 0; d < len; d += DEER.stride) {
      h += (rand() - 0.5) * 2 * DEER.turn;
      let nx = x + Math.sin(h) * DEER.stride, nz = z - Math.cos(h) * DEER.stride;
      if (blocked(nx, nz) || Math.abs(nx) > bounds - 4 || Math.abs(nz) > bounds - 4) {
        h += Math.PI / 2; nx = x + Math.sin(h) * DEER.stride; nz = z - Math.cos(h) * DEER.stride;   // step around it
        if (blocked(nx, nz)) continue;
      }
      x = nx; z = nz;
      const side = (left ? -1 : 1) * 0.08; left = !left;
      const px = x + Math.cos(h) * side, pz = z + Math.sin(h) * side;
      clues.spawn('deerTrack', { cryptidId: 'deer', position: { x: px, y: 0, z: pz }, rotationY: -h, origin: { x, z }, data: {} });
      prints.push({ x: px, z: pz });
    }
    trails.push(prints);
  }
  return trails;
}

// #99: more ordinary wildlife (GDD 4.4 false leads), chosen to look like a cryptid's sign at a
// glance: a black bear's big prints (learn the claw pricks) and coyote droppings (learn the fur and
// bone). Seeded like the deer, kept off the start and the van.
export const WILDLIFE = {
  bear: { trails: 2, prints: 10, stride: 1.25 },
  coyote: { piles: 4 },
};

export function spawnWildlifeSigns({ clues, bounds, blocked = () => false, avoid = [], rand = stream('wildlife') }) {
  const spot = () => {
    for (let tries = 0; tries < 60; tries++) {
      const x = (rand() * 2 - 1) * (bounds - 15), z = (rand() * 2 - 1) * (bounds - 15);
      if (!blocked(x, z) && avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r)) return { x, z };
    }
    return null;
  };
  const out = { bear: [], coyote: [] };
  for (let t = 0; t < WILDLIFE.bear.trails; t++) {
    const s = spot(); if (!s) continue;
    let { x, z } = s, h = rand() * Math.PI * 2, left = true;
    const prints = [];
    for (let i = 0; i < WILDLIFE.bear.prints; i++) {
      h += (rand() - 0.5) * 0.5;
      const nx = x + Math.sin(h) * WILDLIFE.bear.stride, nz = z - Math.cos(h) * WILDLIFE.bear.stride;
      if (blocked(nx, nz) || Math.abs(nx) > bounds - 4 || Math.abs(nz) > bounds - 4) { h += Math.PI / 2; continue; }
      x = nx; z = nz;
      const side = (left ? -1 : 1) * 0.18; left = !left;
      const px = x + Math.cos(h) * side, pz = z + Math.sin(h) * side;
      clues.spawn('bearTrack', { cryptidId: 'bear', position: { x: px, y: 0, z: pz }, rotationY: -h, origin: { x, z }, data: {} });
      prints.push({ x: px, z: pz });
    }
    out.bear.push(prints);
  }
  for (let i = 0; i < WILDLIFE.coyote.piles; i++) {
    const s = spot(); if (!s) continue;
    clues.spawn('coyoteScat', { cryptidId: 'coyote', position: { x: s.x, y: 0, z: s.z }, rotationY: rand() * 6.28, origin: s, data: {} });
    out.coyote.push(s);
  }
  return out;
}

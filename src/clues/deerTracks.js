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

// More ordinary-animal sign (#99, GDD 4.4): a fox's neat single-file trail and owl feathers
// dropped under the pines. Seeded like the deer trails.
export const FOX = { trails: 3, length: [20, 40], stride: 0.35, turn: 0.15 };
export const OWL = { feathers: 6 };

export function spawnFoxTracks({ clues, bounds, blocked = () => false, avoid = [], rand = stream('fox') }) {
  const trails = [];
  for (let t = 0; t < FOX.trails; t++) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      x = (rand() * 2 - 1) * (bounds - 12); z = (rand() * 2 - 1) * (bounds - 12);
      ok = !blocked(x, z) && avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r);
    }
    if (!ok) continue;
    let h = rand() * Math.PI * 2;
    const len = FOX.length[0] + rand() * (FOX.length[1] - FOX.length[0]), prints = [];
    for (let d = 0; d < len; d += FOX.stride) {
      h += (rand() - 0.5) * 2 * FOX.turn;
      const nx = x + Math.sin(h) * FOX.stride, nz = z - Math.cos(h) * FOX.stride;
      if (blocked(nx, nz) || Math.abs(nx) > bounds - 4 || Math.abs(nz) > bounds - 4) { h += Math.PI / 2; continue; }
      x = nx; z = nz;                                  // a fox walks in a single straight line (direct register)
      clues.spawn('foxTrack', { cryptidId: 'fox', position: { x, y: 0, z }, rotationY: -h, origin: { x, z }, data: {} });
      prints.push({ x, z });
    }
    trails.push(prints);
  }
  return trails;
}

export function spawnOwlFeathers({ clues, bounds, blocked = () => false, avoid = [], rand = stream('owl') }) {
  const out = [];
  for (let i = 0, tries = 0; i < OWL.feathers && tries < 200; tries++) {
    const x = (rand() * 2 - 1) * (bounds - 10), z = (rand() * 2 - 1) * (bounds - 10);
    if (blocked(x, z) || avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    clues.spawn('owlFeather', { cryptidId: 'owl', position: { x, y: 0, z }, rotationY: rand() * Math.PI * 2, origin: { x, z }, data: {} });
    out.push({ x, z }); i++;
  }
  return out;
}

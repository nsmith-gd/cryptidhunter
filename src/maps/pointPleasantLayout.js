// Point Pleasant, WV (L08, Mothman; GDD §1.5, §12.2 "reclaimed industrial woodland, stable paths
// and overlooks; manual navigation exit"): the greybox layout as pure data and maths (no three.js).
//
// A fictional reclaimed munitions works gone back to woodland (no real site or access details).
// Layout (north = -z), 180 x 180 m:
//   Old gravel works roads in a rough grid are the stable paths: they never change and every
//   junction is signposted. Rows of grassed-over concrete storage igloos line them.
//   Readable landmarks stand above the trees and can be steered by when your GPS is dead:
//   the Water Tower (centre), the Stack (a brick smokestack, north-west), the Hopper (a concrete
//   loading silo, south-east) and the pylon line that
//   strides along the north edge. The rail spur runs north-south on the west side.
//   Overlooks: Slag Hill (west) and Lookout Knob (north-east), bare tops with long views.
//   The marked road exit, Route 62, leaves through a gate at the south.
// The Mothman perches on the tall things (tower, stack, pylons) and travels along the pylon line
// and the rail spur.

export const PP = {
  half: 90,
  eye: 1.6,
  treeTop: 15,               // the canopy never tops this
  tripCents: 900000,         // GDD 1.5 L08: $9,000 operating cost
  ceilingCents: 7500000,     // $75,000 maximum payout
};

const g = (v, c, w) => Math.exp(-(((v - c) / w) ** 2));

export const OVERLOOKS = [
  { id: 'slagHill', name: 'Slag Hill', x: -55, z: -25, top: 9 },
  { id: 'lookoutKnob', name: 'Lookout Knob', x: 58, z: -52, top: 12 },
];

export function heightAt(x, z) {
  let h = 1.2 * Math.sin(x / 23) * Math.cos(z / 19) + 0.6 * Math.sin((x + z) / 11);
  for (const o of OVERLOOKS) h += o.top * g(Math.hypot(x - o.x, z - o.z), 0, 16) ;
  return h;
}

// ---- landmarks -------------------------------------------------------------------------------------
export const LANDMARKS = [
  { id: 'waterTower', name: 'the Water Tower', x: 10, z: -8, height: 32, perch: 33 },
  { id: 'stack', name: 'the Stack', x: -42, z: -62, height: 40, perch: 41 },
  { id: 'hopper', name: 'the Hopper', x: 68, z: 22, height: 24, perch: 25 },   // a concrete loading silo in the south-east
];
/** The pylon line along the north edge (a corridor), one tower every 30 m. */
export const PYLONS = Array.from({ length: 7 }, (_, i) => ({ x: -84 + i * 28, z: -78, height: 22 }));
export const RAIL = [{ x: -72, z: 90 }, { x: -72, z: 20 }, { x: -70, z: -40 }, { x: -64, z: -88 }];

// ---- stable paths: the old works roads ---------------------------------------------------------------
const J = {
  south: { x: 10, z: 40 }, gate: { x: 10, z: 82 },
  sw: { x: -40, z: 40 }, se: { x: 50, z: 40 },
  w: { x: -40, z: 0 }, c: { x: 10, z: 0 }, e: { x: 50, z: 0 },
  nw: { x: -40, z: -40 }, n: { x: 10, z: -40 }, ne: { x: 50, z: -40 },
  slag: { x: -55, z: -25 }, knob: { x: 58, z: -52 },
};
export const JUNCTIONS = J;
export const ROADS = [
  ['gate', 'south'], ['sw', 'south'], ['south', 'se'],
  ['sw', 'w'], ['south', 'c'], ['se', 'e'],
  ['w', 'c'], ['c', 'e'],
  ['w', 'nw'], ['c', 'n'], ['e', 'ne'],
  ['nw', 'n'], ['n', 'ne'],
  ['w', 'slag'], ['nw', 'slag'], ['ne', 'knob'],
];
export const ROAD_LINES = ROADS.map(([a, b]) => [J[a], J[b]]);
export const EXIT = { x: 10, z: 86, name: 'Route 62', gate: J.gate };
export const START = { x: 12, z: 78 };
/** Signposts at every road junction (manual navigation), pointing along each road out of it. */
export const SIGNS = Object.entries(J).filter(([k]) => k !== 'slag' && k !== 'knob').map(([id, p]) => ({
  id, x: p.x + 2.2, z: p.z + 2.2,
  boards: ROADS.filter((r) => r.includes(id)).map((r) => r[0] === id ? r[1] : r[0]),
}));

/** Storage igloos: grassed concrete mounds in rows along the roads. */
export function planIgloos() {
  const out = [];
  for (const [zr, x0, x1] of [[20, -34, 4], [20, 16, 44], [-20, -34, 4], [-20, 16, 44]]) {
    for (let x = x0; x <= x1; x += 10) out.push({ x, z: zr, w: 6, d: 9, h: 3.2 });
  }
  return out;
}

// ---- trees (seeded) --------------------------------------------------------------------------------
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function distToSeg(x, z, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
}
export const distToRoads = (x, z) => Math.min(...ROAD_LINES.map(([a, b]) => distToSeg(x, z, a, b)));
const distToLine = (x, z, pts) => Math.min(...pts.slice(1).map((b, i) => distToSeg(x, z, pts[i], b)));

export function planTrees(seed = 8146) {
  const r = rng(seed), out = [];
  const igloos = planIgloos();
  for (let i = 0; i < 20000 && out.length < 900; i++) {
    const x = (r() * 2 - 1) * (PP.half - 2), z = (r() * 2 - 1) * (PP.half - 2);
    if (distToRoads(x, z) < 3.5 || distToLine(x, z, RAIL) < 3) continue;
    if (OVERLOOKS.some((o) => Math.hypot(x - o.x, z - o.z) < 12)) continue;           // bare tops
    if (Object.values(J).some((j) => Math.hypot(x - j.x, z - j.z) < 10)) continue;    // old works yards at the junctions
    if ([...LANDMARKS, ...PYLONS].some((l) => Math.hypot(x - l.x, z - l.z) < 6)) continue;
    if (igloos.some((b) => Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5)) continue;
    if (Math.hypot(x - EXIT.x, z - EXIT.z) < 8 || Math.hypot(x - START.x, z - START.z) < 6) continue;
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: 0.25 + r() * 0.2, h: 8 + r() * (PP.treeTop - 8), kind: r() < 0.55 ? 'sycamore' : 'locust' });
  }
  return out;
}

// ---- checks: navigation and sight lines ----------------------------------------------------------------
/** Line of sight past terrain, tree canopies (r 2.2 above 40% of height) and igloos. */
export function lineOfSight(from, to, { trees = planTrees(), igloos = planIgloos() } = {}) {
  const len = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(2, Math.ceil(len / 0.75));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t, y = from.y + (to.y - from.y) * t;
    if (y < heightAt(x, z)) return false;
    for (const tr of trees) {
      const top = heightAt(tr.x, tr.z) + tr.h;
      if (y < top && Math.hypot(x - tr.x, z - tr.z) < (y > heightAt(tr.x, tr.z) + tr.h * 0.4 ? 2.2 : tr.r)) return false;
    }
    for (const b of igloos) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2 && y < heightAt(b.x, b.z) + b.h) return false;
  }
  return true;
}
const eyeAt = (p) => ({ x: p.x, y: heightAt(p.x, p.z) + PP.eye, z: p.z });
const topOf = (l) => ({ x: l.x, y: heightAt(l.x, l.z) + l.height - 1, z: l.z });

/** Which tall landmarks you can see from a point (by id). */
export function landmarksSeenFrom(p, opts) {
  return LANDMARKS.filter((l) => lineOfSight(eyeAt(p), topOf(l), opts)).map((l) => l.id)
    .concat(PYLONS.some((y) => lineOfSight(eyeAt(p), topOf(y), opts)) ? ['pylons'] : []);
}

/** Road network connectivity from the gate (BFS over junction ids). */
export function reachableFrom(start = 'gate') {
  const seen = new Set([start]), q = [start];
  while (q.length) { const a = q.shift(); for (const [u, v] of ROADS) { const o = u === a ? v : v === a ? u : null; if (o && !seen.has(o)) { seen.add(o); q.push(o); } } }
  return seen;
}

// Lake Simcoe shore (L03, GDD §1.5, §12.2): the layout of the greybox, pure data and maths (no
// three.js), so the shape of the level can be unit-tested: terrain height, the shoreline, trail
// loops, camp spots, observation points, the Igopogo's surfacing zones and line of sight.
//
// Layout (north = -z), 180 x 180 m. The lake fills the north; a sandy beach runs east-west along a
// wavy shoreline with a rocky headland, the Point, pushing out into the lake in the middle (the
// long view). Mixed woods rise gently to the south. A gravel side road comes in from the
// south-east boundary to a small parking pull-off (start and the road exit).
//   Two trail loops: the shore loop (beach path out and back along the woods edge) and the woods
//   loop (inland from the parking around the ridge and back).
//   Camp spots: Cedar Cove (west, sheltered by a cedar belt between it and the lake), Rock Shelf
//   (east, in the lee of a granite ridge), and the Open Beach (in the middle, exposed to the
//   wind off the lake, but the best view of the water).
//   Observation points: the Point (bluff, ~6 m up, sees the whole bay), the West Dune and the
//   East Rocks.
// Every surfacing zone must be visible from at least one dry observation point (tested).

export const SIMCOE = {
  half: 90,
  waterY: 0,                 // lake surface
  shallowDepth: 0.9,         // deeper than this is 'deep' (you can't wade out there)
  wadeLimit: 1.1,            // invisible wall where the lake bed drops below this
  shallowSpeed: 0.6,
  eye: 1.6,
  tripCents: 15000,          // GDD 1.5 L03: $150 operating cost
  ceilingCents: 120000,      // $1,200 maximum payout
};

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Shoreline z at x (water is north of it, z < shoreZ). The Point juts out around x = 6. */
export function shoreZ(x) {
  return -8 + 6 * Math.sin((x + 20) / 17) + 3 * Math.sin(x / 7.3) - 30 * Math.exp(-(((x - 6) / 9) ** 2));
}

/** Ground height (m): lake bed below the water north of the shore, rising land to the south. */
export function heightAt(x, z) {
  const d = z - shoreZ(x);                                         // + inland, - out in the lake
  if (d < 0) return Math.max(-3.5, d * 0.22);                      // shelving bed
  let h = Math.min(4, d * 0.06) * smooth(0, 10, d);                // beach, then a gentle rise
  // The Point: a granite bluff on the headland, flat on top.
  h += 5.5 * Math.exp(-(((x - 6) / 6.5) ** 2)) * smooth(0.5, 5, d) * (1 - smooth(16, 26, d));
  // East ridge: the granite rib that shelters Rock Shelf from the lake wind.
  h += 3 * Math.exp(-(((x - 52) / 9) ** 2)) * Math.exp(-(((z - (shoreZ(52) + 9)) / 2.5) ** 2));
  // West dune.
  h += 2.2 * Math.exp(-(((x + 52) / 7) ** 2)) * Math.exp(-(((d - 6) / 3) ** 2));
  return h;
}

export const isDry = (x, z) => heightAt(x, z) > SIMCOE.waterY + 0.05;

// ---- places -----------------------------------------------------------------------------------
const at = (x, inland) => ({ x, z: +(shoreZ(x) + inland).toFixed(2) });

export const PARKING = { x: 58, z: 70 };
export const ROAD = [{ x: 74, z: 92 }, { x: 70, z: 82 }, { x: 62, z: 74 }, PARKING];   // from the boundary in
export const EXIT = { ...PARKING, name: 'the road' };

export const CAMPS = [
  { id: 'cedarCove', name: 'Cedar Cove', ...at(-36, 16), sheltered: true, shelter: 'a belt of cedars between it and the lake' },
  { id: 'rockShelf', name: 'Rock Shelf', ...at(52, 17), sheltered: true, shelter: 'the lee of the granite ridge' },
  { id: 'openBeach', name: 'Open Beach', ...at(-12, 5), sheltered: false, shelter: null },
];

export const OBSERVATION = [
  { id: 'point', name: 'the Point', ...at(6, 12), longView: true },
  { id: 'westDune', name: 'the West Dune', ...at(-52, 6) },
  { id: 'eastRocks', name: 'the East Rocks', ...at(52, 9) },
];

/** Where the Igopogo can surface: open water off the shore (radius r m). */
export const SURFACING = [
  { id: 'westBay', name: 'the west bay', x: -40, z: +(shoreZ(-40) - 24).toFixed(2), r: 6 },
  { id: 'offPoint', name: 'off the Point', x: 6, z: +(shoreZ(6) - 26).toFixed(2), r: 7 },
  { id: 'eastBay', name: 'the east bay', x: 44, z: +(shoreZ(44) - 22).toFixed(2), r: 6 },
];

// Trails: closed loops (first point = last). Shore loop: beach path west to east, back along the
// woods edge. Woods loop: from the parking around the inland woods and back.
const shoreOut = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((x) => at(x, x === 0 ? 14 : 3.5));
const shoreBack = [60, 40, 20, 0, -20, -40, -60].map((x) => at(x, 24));
export const TRAILS = {
  shoreLoop: [...shoreOut, ...shoreBack, shoreOut[0]],
  woodsLoop: [PARKING, { x: 40, z: 50 }, at(20, 24), { x: 0, z: 48 }, { x: 20, z: 66 }, PARKING],
  spur: [PARKING, { x: 56, z: 50 }, at(60, 24)],
};

// ---- vegetation (seeded) --------------------------------------------------------------------
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}
const allTrails = () => [...Object.values(TRAILS), ROAD];

/** Trees as { x, z, r, h, kind }: woods inland, the cedar windbreak at the cove, none on the beach. */
export function planTrees(seed = 3135) {
  const r = rng(seed), out = [];
  const clear = (x, z, pad) => allTrails().every((t) => distToPolyline(x, z, t) > pad)
    && CAMPS.every((c) => Math.hypot(x - c.x, z - c.z) > 7) && OBSERVATION.every((o) => Math.hypot(x - o.x, z - o.z) > 6)
    && Math.hypot(x - PARKING.x, z - PARKING.z) > 9;
  for (let i = 0; i < 2600 && out.length < 230; i++) {
    const x = (r() * 2 - 1) * (SIMCOE.half - 2), z = (r() * 2 - 1) * (SIMCOE.half - 2);
    const d = z - shoreZ(x);
    if (d < 20 || !clear(x, z, 2.5)) continue;
    if (Math.abs(x - 6) < 10 && d < 30) continue;             // the bluff top stays open rock
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: 0.25 + r() * 0.2, h: 7 + r() * 9, kind: r() < 0.6 ? 'pine' : 'birch' });
  }
  // Cedar windbreak: a dense belt on the lake side of Cedar Cove.
  const cove = CAMPS[0];
  for (let k = 0; k < 9; k++) {
    const x = cove.x - 10 + k * 2.5 + (r() - 0.5);
    out.push({ x: +x.toFixed(2), z: +(cove.z - 6 - r() * 1.5).toFixed(2), r: 0.3, h: 5 + r() * 2, kind: 'cedar' });
  }
  return out;
}

/** Granite boulders and ridge blocks as boxes { x, z, w, d, h }. */
export function planRocks() {
  const shelf = CAMPS[1];
  return [
    { x: shelf.x - 4, z: shelf.z - 7, w: 9, d: 2.5, h: 2.6, name: 'granite ridge' },
    { x: shelf.x + 5, z: shelf.z - 6, w: 5, d: 2, h: 2.2, name: 'granite ridge' },
    { x: OBSERVATION[2].x - 3, z: OBSERVATION[2].z + 1, w: 2, d: 2, h: 1.2, name: 'boulder' },
    { x: -20, z: +(shoreZ(-20) + 2).toFixed(2), w: 1.6, d: 1.4, h: 0.9, name: 'boulder' },
    { x: 28, z: +(shoreZ(28) + 2.5).toFixed(2), w: 1.8, d: 1.5, h: 1.0, name: 'boulder' },
  ];
}

// ---- line of sight ---------------------------------------------------------------------------
/**
 * Is `to` visible from `from` (both { x, y, z })? The ray must stay above the terrain and clear
 * of every tree trunk / canopy (cylinder r, height h) and rock box, sampled every 0.5 m.
 */
export function lineOfSight(from, to, { trees = planTrees(), rocks = planRocks() } = {}) {
  const len = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(2, Math.ceil(len / 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t, y = from.y + (to.y - from.y) * t;
    if (y < heightAt(x, z) + 0.05) return false;
    for (const tr of trees) {
      const cr = tr.kind === 'birch' ? 1.4 : 1.8;            // trunk plus foliage; cedars are bushy to the ground
      if (Math.hypot(x - tr.x, z - tr.z) < (y < tr.h * 0.35 && tr.kind !== 'cedar' ? tr.r : cr) && y < heightAt(tr.x, tr.z) + tr.h) return false;
    }
    for (const b of rocks) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2 && y < heightAt(b.x, b.z) + b.h) return false;
  }
  return true;
}

/** For each surfacing zone: which observation points see its centre (a head just above water). */
export function visibilityReport(opts = {}) {
  return SURFACING.map((s) => {
    const target = { x: s.x, y: SIMCOE.waterY + 0.6, z: s.z };
    const seenFrom = OBSERVATION.filter((o) => isDry(o.x, o.z)
      && lineOfSight({ x: o.x, y: heightAt(o.x, o.z) + SIMCOE.eye, z: o.z }, target, opts)).map((o) => o.id);
    return { id: s.id, seenFrom };
  });
}

/** How far you can see out over open water from a point (m, up to `max`), looking due north. */
export function viewDistance(o, max = 150, opts = {}) {
  const from = { x: o.x, y: heightAt(o.x, o.z) + SIMCOE.eye, z: o.z };
  let best = 0;
  for (let d = 10; d <= max; d += 10) if (lineOfSight(from, { x: o.x, y: 0.6, z: o.z - d }, opts)) best = d;
  return best;
}

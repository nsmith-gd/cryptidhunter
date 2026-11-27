// Ozark Mountains (L07, Ozark Howler; GDD §1.5, §12.2 "steep ridges, valleys, multiple camp
// positions; shorter exposed vs longer sheltered route"): the greybox layout as pure data and
// maths (no three.js), so the shape of the level can be unit-tested.
//
// Layout (north = -z), 200 x 200 m:
//   south   — the trailhead and road home (start and exit)
//   Pine Ridge (z ≈ 45): a steep ridge between the trailhead and the valley. Its crest is bare
//             rock and grass on the west (the Bald), wooded elsewhere; on the east it drops to a
//             low wooded saddle, the Gap.
//   the valley (z ≈ 0): Hollow Creek winds east-west along the bottom.
//   Bald Knob (z ≈ -50): the high north ridge, where the Howler dens.
// Two routes home from the valley junction:
//   the Bald Route — short and steep, straight over Pine Ridge on open ground: fast, but you're
//                    skylined on the crest for anything watching from the ridges.
//   the Gap Route  — long and gentle, east along the creek and up through the wooded Gap.
// Camps: Creek Bend (valley floor, sheltered by trees), the Bench (a shelf on Bald Knob's south
// flank), Bluff Top (on the Knob's crest, exposed, wide view) and Spring Hollow (by the Gap).

export const OZARK = {
  half: 100,
  creekDepth: 1.2,
  eye: 1.6,
  tripCents: 500000,        // GDD 1.5 L07: $5,000 operating cost
  ceilingCents: 4000000,    // $40,000 maximum payout
};

const g = (v, c, w) => Math.exp(-(((v - c) / w) ** 2));

/** Creek centre line z at x. */
export const creekZ = (x) => 2 + 5 * Math.sin(x / 23) + 2 * Math.sin(x / 9);

/** Ground height (m). */
export function heightAt(x, z) {
  let h = 20 * g(z, -50, 13) * (1 + 0.15 * Math.sin(x / 19));              // Bald Knob, the high north ridge
  h += 15 * g(z, 45, 10) * (1 - 0.72 * g(x, 70, 13));                       // Pine Ridge, with the Gap in the east
  h += 3 * g(z, 92, 18) - 2.5 * g(z, 70, 12) * (1 - g(x, 70, 30));          // trailhead bench above a little draw
  h += 2.5 * g(z, -22, 6) * g(x, 35, 14);                                   // the Bench: a shelf on the Knob's flank
  h -= OZARK.creekDepth * g(z, creekZ(x), 3);                               // the creek bed
  h += 0.6 * Math.sin(x / 7.1) * Math.cos(z / 8.3);                         // rough ground
  return h;
}

/** Steepness (rise per metre) at (x, z). */
export function slopeAt(x, z, e = 0.5) {
  const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

export const inCreek = (x, z) => Math.abs(z - creekZ(x)) < 1.8;

export const TRAILHEAD = { x: 0, z: 90 };
export const EXIT = { ...TRAILHEAD, name: 'the trailhead' };
export const ROAD = [{ x: -8, z: 100 }, { x: -4, z: 95 }, TRAILHEAD];
export const JUNCTION = { x: 0, z: 8 };

export const ROUTES = {
  bald: { name: 'the Bald Route', exposed: true, pts: [JUNCTION, { x: -8, z: 20 }, { x: -12, z: 34 }, { x: -12, z: 45 }, { x: -8, z: 60 }, { x: -3, z: 76 }, TRAILHEAD] },
  gap: { name: 'the Gap Route', exposed: false, pts: [JUNCTION, { x: 25, z: 9 }, { x: 50, z: 14 }, { x: 66, z: 24 }, { x: 71, z: 40 }, { x: 70, z: 55 }, { x: 52, z: 74 }, { x: 25, z: 86 }, TRAILHEAD] },
};
export const SIDE_TRAILS = [
  [JUNCTION, { x: -20, z: 6 }, { x: -40, z: 7 }],                    // to Creek Bend
  [JUNCTION, { x: 15, z: -6 }, { x: 34, z: -20 }],                   // up to the Bench
  [{ x: 34, z: -20 }, { x: 15, z: -34 }, { x: -10, z: -48 }],        // on up to Bluff Top
];

export const CAMPS = [
  { id: 'creekBend', name: 'Creek Bend', x: -40, z: 9, sheltered: true },
  { id: 'bench', name: 'the Bench', x: 35, z: -22, sheltered: true },
  { id: 'bluffTop', name: 'Bluff Top', x: -10, z: -50, sheltered: false },
  { id: 'springHollow', name: 'Spring Hollow', x: 60, z: 22, sheltered: true },
];

/** Where the Howler dens (its spawn) and a deer carcass that gives off scent all night. */
export const DEN = { x: 45, z: -58 };
export const CARCASSES = [{ id: 'deer', name: 'a deer carcass', x: 18, z: -4 }];

// ---- polylines -----------------------------------------------------------------------------
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}
/** Points every `step` m along a polyline (with ground height). */
export function sample(pts, step = 2) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) { const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; out.push({ x, z, y: heightAt(x, z) }); }
  }
  const l = pts.at(-1); out.push({ x: l.x, z: l.z, y: heightAt(l.x, l.z) });
  return out;
}
/** Walking length of a route, counting the climb (m). */
export function routeLength(pts) {
  const s = sample(pts, 1);
  let L = 0;
  for (let i = 1; i < s.length; i++) L += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y, s[i].z - s[i - 1].z);
  return L;
}

// ---- trees (seeded) ---------------------------------------------------------------------------
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Is (x, z) on open ground (no trees): the Bald on Pine Ridge's west crest and Bluff Top. */
export const isOpen = (x, z) => (Math.abs(x + 9) < 15 && z > 22 && z < 68) || Math.hypot(x + 10, z + 50) < 12;

/** Oak-hickory woods everywhere but the open ground, trails, camps and the creek. */
export function planTrees(seed = 7144) {
  const r = rng(seed), out = [];
  const lines = [...Object.values(ROUTES).map((x) => x.pts), ...SIDE_TRAILS, ROAD];
  for (let i = 0; i < 30000 && out.length < 1300; i++) {
    const x = (r() * 2 - 1) * (OZARK.half - 2), z = (r() * 2 - 1) * (OZARK.half - 2);
    if (isOpen(x, z) || inCreek(x, z)) continue;
    if (lines.some((l) => distToPolyline(x, z, l) < 1.8)) continue;
    if (CAMPS.some((c) => Math.hypot(x - c.x, z - c.z) < 6) || Math.hypot(x - TRAILHEAD.x, z - TRAILHEAD.z) < 10) continue;
    if (CARCASSES.some((c) => Math.hypot(x - c.x, z - c.z) < 3)) continue;
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: 0.25 + r() * 0.25, h: 9 + r() * 8, kind: r() < 0.7 ? 'oak' : 'pine' });
  }
  return out;
}

/** Share of a route's length with tree cover within `reach` m (overhead/beside you). */
export function coverFraction(pts, trees = planTrees(), reach = 6) {
  const s = sample(pts, 2);
  let covered = 0;
  for (const p of s) if (trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < reach)) covered++;
  return covered / s.length;
}

/** Cliff bands: steep, rocky stretches of ridge flank you can't climb (boxes { x, z, w, d, h }). */
export function planCliffs() {
  const out = [];
  // Pine Ridge's steep north face, except where the two routes cross it.
  for (let x = -96; x < 96; x += 6) {
    if (Math.abs(x + 12) < 8 || Math.abs(x - 70) < 16) continue;
    out.push({ x: x + 3, z: 37, w: 6, d: 1.5, h: 3.5 });
  }
  // Bald Knob's south face below the crest, except the side trail.
  for (let x = -96; x < 96; x += 6) {
    if (Math.abs(x + 2) < 14) continue;
    out.push({ x: x + 3, z: -40, w: 6, d: 1.5, h: 4 });
  }
  return out;
}

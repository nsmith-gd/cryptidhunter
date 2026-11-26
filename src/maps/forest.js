import * as THREE from 'three';
import { ForestKit } from '../art/forestKit.js';
import { dressForest } from './forestDressing.js';
import { TerrainPainter, ribbonGeometry } from './terrainPainter.js';
import { buildTrailSigns } from './trailSigns.js';
import { planLandmarks, buildLandmarks } from './forestLandmarks.js';
import { leafLitterTexture, dirtTexture, mossTexture, grassTexture } from '../art/forestTex.js';

// Pine Hollow Forest — greybox (L0). The starter hunting ground and Bigfoot's home.
// Layout (north = -z), 300 x 300 m:
//   south  — trailhead parking (player start, truck)
//   middle — the old cabin clearing (west), an abandoned campsite (east), and a creek that
//            meanders across the whole map west to east (wade it slowly, or use the footbridge)
//   north  — a rock ridge spans the map; walk through the main pass or the far-west notch.
//            Beyond it: the fire lookout tower (tall landmark) and Bigfoot's hollow.
// Dirt trails link every landmark; everything else is dense pine with fog.

export const FOREST = {
  half: 150,
  rutDepth: 0.17,         // how far the trails are worn into the ground (m)
  creekHalfWidth: 3,      // metres either side of the creek centre line
  creekSpeed: 0.6,        // speed multiplier wading the creek
  deck: 0.3,              // footbridge / porch height (under the player's step height)
};

// Creek centre line, west to east.
const CREEK = [[-152, -8], [-110, 8], [-70, -2], [-30, 14], [10, 8], [35, 20], [70, 6], [110, 24], [152, 14]];
// Ridge: rock wall along z ≈ RIDGE_Z with two gaps [x0, x1].
const RIDGE_Z = -62, RIDGE_GAPS = [[12, 26], [-128, -118]];

const L = {
  trailhead: { x: 0, z: 132 },
  fork: { x: 0, z: 100 },
  cabin: { x: -45, z: 68 },
  campsite: { x: 78, z: 82 },
  footbridge: { x: 35, z: 20 },
  boulders: { x: -88, z: -32 },
  ridgePass: { x: 19, z: RIDGE_Z },
  westNotch: { x: -123, z: RIDGE_Z },
  lookout: { x: 70, z: -88 },
  hollow: { x: -5, z: -112 },
};

// Names on the trail signs and the paper map (#70).
export const PLACE_NAMES = {
  trailhead: 'Parking', cabin: 'Old cabin', campsite: 'Campsite', footbridge: 'Footbridge', boulders: 'Boulders',
  ridgePass: 'Ridge pass', westNotch: 'West notch', lookout: 'Lookout', hollow: 'The hollow',
};

// Dirt trails (polylines). Trees stay off them.
const TRAILS = [
  [L.trailhead, L.fork, { x: -20, z: 86 }, L.cabin],
  [L.fork, { x: 30, z: 70 }, { x: 40, z: 45 }, L.footbridge, { x: 30, z: -10 }, { x: 22, z: -40 }, L.ridgePass, { x: 14, z: -85 }, L.hollow],
  [{ x: 30, z: 70 }, { x: 55, z: 80 }, L.campsite],
  [{ x: 22, z: -40 }, { x: -40, z: -30 }, L.boulders, { x: -118, z: -40 }, L.westNotch, { x: -110, z: -95 }, { x: -45, z: -115 }, L.hollow],
  [{ x: 14, z: -85 }, { x: 45, z: -92 }, L.lookout],
  [L.cabin, { x: -70, z: 40 }, { x: -80, z: 5 }], // down to the creek ford west of the cabin
];

// Clearings: [centre, radius] — no trees.
const CLEARINGS = [
  [L.trailhead, 16], [L.cabin, 15], [L.campsite, 11], [L.boulders, 12], [L.lookout, 12], [L.hollow, 16], [L.fork, 6],
];

const COLORS = {
  floor: 0x2b3324, trail: 0x4a3f2e, bark: 0x3d3128, needles: 0x1f3324, needlesDark: 0x18291d,
  snag: 0x4b4640, rock: 0x55575a, rockDark: 0x3f4144, wood: 0x5a4a3a, woodDark: 0x3e3329,
  water: 0x2c4450, bed: 0x1d2420, truck: 0x5b6a72,
};

export function buildForestMap(scene) {
  const H = FOREST.half;
  const firstChild = scene.children.length;   // everything after this is the map (for the texture pass)
  const colliders = [];
  const rng = mulberry32(1337);
  const mats = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra }));
    return mats.get(key);
  };
  const box = (x0, z0, x1, z1, y0, y1, color, { collide = true, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat(color));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (name) m.name = name;
    scene.add(m);
    if (collide) colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
    return m;
  };
  // Box centred at (x, z) with size (w, d), rotated about Y — collider is its AABB.
  const rotBox = (x, z, w, d, y0, y1, rotY, color, opts = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), mat(color));
    m.position.set(x, (y0 + y1) / 2, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    if (opts.name) m.name = opts.name;
    scene.add(m);
    if (opts.collide !== false) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };

  // --- Ground: one terrain surface with the trails, clearings and creek banks painted in ------
  // (#61, terrainPainter.js). No strips or discs laid over the floor, so nothing z-fights.
  const terrain = new TerrainPainter({ half: H, res: 1024, seed: 1337 });
  const creekPts = CREEK.map(([x, z]) => ({ x, z }));
  for (const t of TRAILS) terrain.paintPath(t, 'grass', { width: 7, edge: 1.2, wobble: 1.4 });      // grassy shoulders
  for (const [c, r] of CLEARINGS) terrain.paintDisc(c, r * 1.05, 'grass', { edge: 2, wobble: 2.5 });
  terrain.paintPath(creekPts, 'bank', { width: FOREST.creekHalfWidth * 2 + 1.8, edge: 0.45, wobble: 0.5 });
  for (const t of TRAILS) terrain.paintPath(t, 'dirt', { width: 3, edge: 0.45, wobble: 0.45 });
  for (const [c, r] of CLEARINGS) terrain.paintDisc(c, r * 0.7, 'dirt', { edge: 1.2, wobble: 1.6 });
  // Sunken ruts (director: "I like sunken ruts, it helps with the cinematic style"): the trails are
  // worn ~12 cm into the forest floor, fading out where they open into a clearing.
  const clearingFade = (x, z) => {
    let f = 1;
    for (const [c, r] of CLEARINGS) {
      const d = Math.hypot(x - c.x, z - c.z) / (r * 0.75);
      f = Math.min(f, Math.min(1, Math.max(0, (d - 0.55) / 0.45)));
    }
    return f;
  };
  const rutDepth = new URLSearchParams(location.search).has('flattrails') ? 0 : FOREST.rutDepth; // ?flattrails: before/after
  if (rutDepth > 0) for (const t of TRAILS) terrain.carvePath(t, { width: 3, depth: rutDepth, edge: 0.45, wobble: 0.45, lip: 0.04, fade: clearingFade });
  const ground = new THREE.Mesh(terrain.buildGeometry(), new THREE.MeshStandardMaterial({ color: 0x2b3324, roughness: 1 }));
  ground.receiveShadow = true;
  ground.name = 'forest-terrain';
  scene.add(ground);

  // --- Creek: one continuous water ribbon over the painted bank (no overlapping strips). ----
  {
    const water = new THREE.Mesh(ribbonGeometry(creekPts, FOREST.creekHalfWidth * 2, 0.06, 4), new THREE.MeshStandardMaterial({
      color: COLORS.water, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    water.receiveShadow = true;
    water.name = 'creek';
    scene.add(water);
  }
  // Footbridge over the creek on the main trail (deck at FOREST.deck so the player steps on).
  {
    const { x, z } = L.footbridge, D = FOREST.deck;
    const rot = Math.atan2(30 - 40, -10 - 45); // deck runs along the trail, across the creek
    rotBox(x, z, 2.4, 11, 0, D, rot, COLORS.wood, { name: 'footbridge' });
    const s = Math.sin(rot), c = Math.cos(rot);
    for (const side of [-1.25, 1.25]) {
      rotBox(x + c * side, z - s * side, 0.12, 11, D, D + 1, rot, COLORS.woodDark, { collide: false });
    }
  }
  // Stepping stones at the west ford.
  for (const [x, z] of [[-81, 2.5], [-80, 0.5], [-79.5, -1.5], [-79, -3.5]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.25, 6), mat(COLORS.rock));
    st.position.set(x, 0.12, z);
    scene.add(st);
  }

  // --- Perimeter: a wall of dark treeline so you can't walk off the map. -------------------
  const W = COLORS.needlesDark;
  box(-H, -H - 2, H, -H, 0, 10, W); box(-H, H, H, H + 2, 0, 10, W);
  box(-H - 2, -H, -H, H, 0, 10, W); box(H, -H, H + 2, H, 0, 10, W);

  // --- The ridge: irregular rock blocks across the map with two gaps. ----------------------
  for (let x = -H; x < H; x += 6) {
    const x1 = Math.min(H, x + 6);
    if (RIDGE_GAPS.some(([g0, g1]) => x1 > g0 && x < g1)) continue;
    const zOff = Math.sin(x * 0.05) * 6 + (rng() - 0.5) * 3;
    const h = 4 + rng() * 6 + (Math.abs(x) < 60 ? 3 : 0);
    box(x, RIDGE_Z + zOff - 5, x1, RIDGE_Z + zOff + 5, 0, h, rng() < 0.5 ? COLORS.rock : COLORS.rockDark, { name: 'ridge' });
    // A stepped shoulder so it reads as a ridge rather than a wall.
    box(x, RIDGE_Z + zOff + 5, x1, RIDGE_Z + zOff + 8, 0, h * 0.45, COLORS.rockDark, { name: 'ridge' });
  }
  // Big rocks flanking the main pass.
  box(8, RIDGE_Z - 6, 12, RIDGE_Z + 6, 0, 13, COLORS.rock, { name: 'pass-rock' });
  box(26, RIDGE_Z - 6, 30, RIDGE_Z + 6, 0, 11, COLORS.rock, { name: 'pass-rock' });

  // --- Trailhead: parking pad, trail sign. (The hunt places the truck behind the start.) ----
  box(-6, 120, -5.8, 120.2, 0, 2, COLORS.woodDark, { name: 'trail-sign-post' });
  box(-6.8, 119.95, -5, 120.05, 1.5, 2.2, COLORS.wood, { collide: false, name: 'trail-sign' });

  // --- The old cabin: walk-in, door on the east side, porch, warm window light. ------------
  {
    const { x, z } = L.cabin, D = FOREST.deck, hw = 4, hd = 3, wall = 2.8, t = 0.25;
    const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
    box(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, 0, D, COLORS.woodDark, { name: 'cabin-floor' });
    box(x0, z0, x1, z0 + t, D, wall, COLORS.wood);                    // north wall
    box(x0, z1 - t, x - 1, z1, D, wall, COLORS.wood);                 // south wall with a window gap
    box(x + 1, z1 - t, x1, z1, D, wall, COLORS.wood);
    box(x - 1, z1 - t, x + 1, z1, D, 1.1, COLORS.wood);               // under the window
    box(x - 1, z1 - t, x + 1, z1, 2.1, wall, COLORS.wood);            // over the window
    box(x0, z0, x0 + t, z1, D, wall, COLORS.wood);                    // west wall
    box(x1 - t, z0, x1, z - 0.7, D, wall, COLORS.wood);               // east wall, door gap
    box(x1 - t, z + 0.7, x1, z1, D, wall, COLORS.wood);
    box(x1 - t, z - 0.7, x1, z + 0.7, 2.3, wall, COLORS.wood);        // lintel
    // Pitched roof: two slabs.
    for (const sgn of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1, 0.2, hd + 0.9), mat(COLORS.woodDark));
      r.position.set(x, wall + 0.8, z + sgn * (hd / 2 + 0.2));
      r.rotation.x = sgn * 0.5;
      r.castShadow = true;
      r.name = 'cabin-roof';
      scene.add(r);
    }
    box(x - 0.5, z0 + 0.6, x + 0.5, z0 + 1.2, wall, wall + 2.4, COLORS.rockDark, { name: 'chimney' });
    box(x1, z - 2, x1 + 2.2, z + 2, 0, D, COLORS.woodDark, { name: 'porch' });
    box(x0 + 0.5, z - 1, x0 + 1.5, z + 1, D, D + 0.8, COLORS.woodDark, { name: 'cabin-table' });
    // Woodpile against the north wall.
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.8, 6), mat(COLORS.wood));
      log.rotation.z = Math.PI / 2;
      log.position.set(x - 1.5 + (i % 3) * 0.32, 0.15 + Math.floor(i / 3) * 0.28, z0 - 0.5);
      scene.add(log);
    }
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 2.6, 0, z0 - 0.75), new THREE.Vector3(x - 0.4, 0.6, z0 - 0.25)));
    // Someone left a lamp on: warm light through the window.
    const lamp = new THREE.PointLight(0xffa45a, 5, 14, 1.6);
    lamp.position.set(x, 1.8, z + 1);
    scene.add(lamp);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({ color: 0xffb26a }));
    glow.position.set(x, 1.6, z1 - 0.05);
    scene.add(glow);
  }

  // --- Abandoned campsite: fire ring with embers, a tent, logs to sit on. ------------------
  {
    const { x, z } = L.campsite;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), mat(COLORS.rockDark));
      s.position.set(x + Math.cos(a) * 0.9, 0.15, z + Math.sin(a) * 0.9);
      scene.add(s);
    }
    const ember = new THREE.PointLight(0xff5a20, 2.5, 8, 1.8);
    ember.position.set(x, 0.4, z);
    scene.add(ember);
    rotBox(x + 4, z - 3, 2.4, 3, 0, 1.4, 0.4, 0x5d6a4a, { name: 'tent' });
    for (const [dx, dz, r] of [[-2.5, 0, 0], [0, 2.5, Math.PI / 2]]) rotBox(x + dx, z + dz, 0.5, 2.2, 0, 0.45, r, COLORS.wood);
  }

  // --- Boulder field (the kit draws the rocks; see boulderSpots below). ----------------------
  const boulderSpots = [];
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, d = 3 + rng() * 8, s = 1 + rng() * 2.2;
    const bx = L.boulders.x + Math.cos(a) * d, bz = L.boulders.z + Math.sin(a) * d;
    rng();
    boulderSpots.push({ x: bx, z: bz, s });
    colliders.push(new THREE.Box3(new THREE.Vector3(bx - s * 0.8, 0, bz - s * 0.8), new THREE.Vector3(bx + s * 0.8, s * 1.4, bz + s * 0.8)));
  }

  // --- Fire lookout tower: the tall landmark, lamp on top visible over the trees. ----------
  {
    const { x, z } = L.lookout, top = 16;
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(x + dx - 0.2, z + dz - 0.2, x + dx + 0.2, z + dz + 0.2, 0, top, COLORS.woodDark, { name: 'lookout-leg' });
    box(x - 2.8, z - 2.8, x + 2.8, z + 2.8, top, top + 0.3, COLORS.wood, { collide: false, name: 'lookout-deck' });
    box(x - 2.4, z - 2.4, x + 2.4, z + 2.4, top + 0.3, top + 2.6, COLORS.wood, { collide: false, name: 'lookout-cab' });
    box(x - 3, z - 3, x + 3, z + 3, top + 2.6, top + 2.9, COLORS.woodDark, { collide: false, name: 'lookout-roof' });
    const lamp = new THREE.PointLight(0xffc070, 8, 40, 1.4);
    lamp.position.set(x, top + 1.5, z + 2.6);
    scene.add(lamp);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
    win.position.set(x, top + 1.5, z + 2.41);
    scene.add(win);
  }

  // --- Bigfoot's hollow: a ring of boulders, a huge fallen log, a crude nest. --------------
  {
    const { x, z } = L.hollow;
    const nest = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.45, 5, 10), mat(0x3b2a1c));
    nest.rotation.x = -Math.PI / 2;
    nest.position.set(x - 3, 0.25, z + 2);
    nest.name = 'bigfoot-nest';
    scene.add(nest);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, s = 1.2 + rng() * 1.3;
      const bx = x + Math.cos(a) * 13, bz = z + Math.sin(a) * 13;
      if (Math.abs(a - Math.PI * 0.5) < 0.6) continue; // opening toward the south trail
      boulderSpots.push({ x: bx, z: bz, s });
      colliders.push(new THREE.Box3(new THREE.Vector3(bx - s * 0.8, 0, bz - s * 0.8), new THREE.Vector3(bx + s * 0.8, s * 1.4, bz + s * 0.8)));
    }
  }

  const creekLine = CREEK.map(([x, z]) => ({ x, z }));
  // --- Trees and undergrowth: the forest kit (art/forestKit.js), instanced. --------------
  // GDD map pieces (#91): kiosk, boundary fence, tree stand, traces, puddles. ?nolandmarks: off.
  const landmarkPlan = new URLSearchParams(location.search).has('nolandmarks') ? null : planLandmarks(L, H);
  const keepClear = (x, z) => {
    if (landmarkPlan?.clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) return true;
    for (const [c, r] of CLEARINGS) if (Math.hypot(x - c.x, z - c.z) < r) return true;
    for (const t of TRAILS) if (distToPolyline(x, z, t) < 3.2) return true;
    if (distToPolyline(x, z, creekLine) < FOREST.creekHalfWidth + 1.5) return true;
    if (Math.abs(z - RIDGE_Z) < 17) return true; // ridge and its shoulders
    return false;
  };
  // Softer rule for low undergrowth: may crowd trail edges and clearing rims, never the tread.
  const onTread = (x, z) => {
    if (landmarkPlan?.clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r * 0.8)) return true;
    for (const [c, r] of CLEARINGS) if (Math.hypot(x - c.x, z - c.z) < r * 0.62) return true;
    for (const t of TRAILS) if (distToPolyline(x, z, t) < 2.1) return true;
    if (distToPolyline(x, z, creekLine) < FOREST.creekHalfWidth + 0.4) return true;
    if (Math.abs(z - RIDGE_Z) < 9) return true;
    return false;
  };
  const near = (x, z) => ({
    trail: Math.min(...TRAILS.map((t) => distToPolyline(x, z, t))),
    creek: distToPolyline(x, z, creekLine),
  });
  const rnd = (a, b) => a + rng() * (b - a);
  const choose = (weights) => { let t = rng() * weights.reduce((s, w) => s + w[1], 0); for (const [k, w] of weights) if ((t -= w) <= 0) return k; return weights[0][0]; };

  const trees = [];
  const SP = 6.2; // jittered grid spacing
  for (let gx = -H + 4; gx < H - 4; gx += SP) {
    for (let gz = -H + 4; gz < H - 4; gz += SP) {
      const x = gx + (rng() - 0.5) * SP * 0.8, z = gz + (rng() - 0.5) * SP * 0.8;
      if (keepClear(x, z)) continue;
      trees.push({ x, z, r: 0.22 + rng() * 0.3, h: 9 + rng() * 9, snag: rng() < 0.07, rot: rng() * Math.PI * 2 });
    }
  }
  // Young pines filling gaps in the understory (and softening clearing edges).
  for (let i = 0, n = 0; i < 2500 && n < 420; i++) {
    const x = rnd(-H + 4, H - 4), z = rnd(-H + 4, H - 4);
    if (onTread(x, z) || Math.abs(z - RIDGE_Z) < 12) continue;
    if (trees.some((t) => Math.abs(t.x - x) < 2.2 && Math.abs(t.z - z) < 2.2)) continue;
    trees.push({ x, z, r: 0.1 + rng() * 0.06, h: 2.4 + rng() * 3.8, young: true, rot: rng() * Math.PI * 2 });
    n++;
  }

  const kit = new ForestKit(77);
  const pineKeys = kit.variants('pine'), youngKeys = kit.variants('youngPine');
  for (const t of trees) {
    const stretch = () => t.h * (0.88 + rng() * 0.26);
    if (t.snag) kit.add(rng() < 0.5 ? 'snag:0' : 'snag:1', t.x, 0, t.z, t.rot, [t.h * 1.1, t.h, t.h * 1.1]);
    else {
      // Any of the pine shapes, each tree leaning a touch and tinted a little differently, so
      // neighbours never read as copies (#60).
      const keys = t.young ? youngKeys : pineKeys;
      const lean = { x: rnd(-0.035, 0.035), z: rnd(-0.035, 0.035) };
      const v = rnd(0.68, 0.98), warm = rnd(-0.06, 0.06);
      const tint = new THREE.Color(v * (1 + warm), v, v * (1 - warm * 1.5));
      kit.add(keys[Math.floor(rng() * keys.length)], t.x, 0, t.z, t.rot, [stretch(), t.h, stretch()], lean, tint);
    }
    colliders.push(new THREE.Box3(new THREE.Vector3(t.x - t.r, 0, t.z - t.r), new THREE.Vector3(t.x + t.r, t.h, t.z + t.r)));
    // Needle litter and fallen cones around most trunks.
    // Needle litter under the trunk is painted into the terrain (moss/duff pad) instead of a decal.
    if (!t.young && rng() < 0.75) { rnd(-0.6, 0.6); rnd(-0.6, 0.6); rng(); rnd(3, 5.5); rnd(3, 5.5); if (((Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1 + 1) % 1 < 0.35) terrain.paintDisc({ x: t.x, z: t.z }, 1.2 + t.r * 3, 'moss', { edge: 0.8, wobble: 1 }); }
  }

  // Ferns: thickest in shade under the pines and along the creek banks.
  for (let i = 0, n = 0; i < 9000 && n < 1700; i++) {
    const x = rnd(-H + 3, H - 3), z = rnd(-H + 3, H - 3);
    if (onTread(x, z)) continue;
    const d = near(x, z);
    const bank = d.creek < FOREST.creekHalfWidth + 6;
    if (!bank && rng() < 0.45) continue;
    kit.add(choose([['fern:0', 5], ['fern:1', 3], ['fern:2', 2]]), x, 0, z, rng() * 6.28, rnd(0.75, 1.45) * (bank ? 1.15 : 1));
    n++;
  }
  // Bushes: huckleberry and salal, clumping along trail edges where there's light.
  for (let i = 0, n = 0; i < 6000 && n < 650; i++) {
    const x = rnd(-H + 3, H - 3), z = rnd(-H + 3, H - 3);
    if (onTread(x, z)) continue;
    const d = near(x, z);
    if (d.trail > 9 && rng() < 0.6) continue;
    const s = rnd(0.7, 1.5);
    kit.add(choose([['bush:0', 4], ['bush:1', 3], ['bush:2', 2]]), x, 0, z, rng() * 6.28, [s * rnd(0.9, 1.3), s, s * rnd(0.9, 1.3)]);
    n++;
  }
  // Grass and sedge tufts: in clearings, on trail shoulders, and along the creek.
  for (let i = 0, n = 0; i < 14000 && n < 4200; i++) {
    const x = rnd(-H + 3, H - 3), z = rnd(-H + 3, H - 3);
    const d = near(x, z);
    let inClearing = false;
    for (const [c, r] of CLEARINGS) if (Math.hypot(x - c.x, z - c.z) < r * 1.1) inClearing = true;
    const trailEdge = d.trail > 1.4 && d.trail < 4.5;
    const bank = d.creek > FOREST.creekHalfWidth + 0.2 && d.creek < FOREST.creekHalfWidth + 3;
    if (!(inClearing || trailEdge || bank) && rng() < 0.9) continue;
    if (d.trail < 1.3 || d.creek < FOREST.creekHalfWidth + 0.2) continue;
    if (inClearing && CLEARINGS.some(([c, r]) => Math.hypot(x - c.x, z - c.z) < r * 0.45) && rng() < 0.7) continue;
    kit.add(inClearing && rng() < 0.6 ? 'grass:1' : 'grass:0', x, 0, z, rng() * 6.28, rnd(0.7, 1.4));
    n++;
  }

  // Fallen logs (solid): kept off trails, clearings and the creek.
  const logCollider = (x, z, rot, len, dia) => {
    const dx = Math.cos(rot), dz = -Math.sin(rot);
    const segs = Math.max(1, Math.ceil(len / 1.2));
    for (let s = 0; s < segs; s++) {
      const t = (s + 0.5) / segs - 0.5, cx = x + dx * t * len, cz = z + dz * t * len, hw = Math.max(dia / 2, len / segs / 2 * 0.9);
      colliders.push(new THREE.Box3(new THREE.Vector3(cx - hw, 0, cz - hw), new THREE.Vector3(cx + hw, dia * 0.9, cz + hw)));
    }
  };
  const placeLog = (key, x, z, rot, len, dia) => {
    kit.add(key, x, dia * 0.42, z, rot, [len, dia, dia], { x: 0, z: rnd(-0.03, 0.03) });
    logCollider(x, z, rot, len, dia);
  };
  for (let i = 0, n = 0; i < 4000 && n < 85; i++) {
    const x = rnd(-H + 8, H - 8), z = rnd(-H + 8, H - 8), rot = rng() * Math.PI, len = rnd(3.5, 10), dia = rnd(0.45, 0.95);
    const ends = [-0.5, 0, 0.5].map((t) => [x + Math.cos(rot) * t * len, z - Math.sin(rot) * t * len]);
    if (ends.some(([ex, ez]) => keepClear(ex, ez))) continue;
    if (trees.some((t) => ends.some(([ex, ez]) => Math.hypot(t.x - ex, t.z - ez) < t.r + dia * 0.6 + 0.2))) continue;
    placeLog(choose([['log:0', 2], ['log:1', 4], ['log:2', 2], ['log:3', 2]]), x, z, rot, len, dia);
    n++;
  }

  // Rocks: lichen boulders through the woods, scree at the foot of the ridge, stones on the banks.
  const placeRock = (key, x, z, s, solid = true) => {
    const sc = [s * rnd(0.85, 1.2), s * rnd(0.85, 1.15), s * rnd(0.85, 1.2)];
    kit.add(key, x, 0, z, rng() * 6.28, sc);
    const tall = { 'rock:0': 0.7, 'rock:1': 0.55, 'rock:2': 0.32, 'rock:3': 1.1, 'rock:4': 0.35 }[key] * sc[1];
    if (solid && tall > 0.3) colliders.push(new THREE.Box3(new THREE.Vector3(x - s * 0.5, 0, z - s * 0.5), new THREE.Vector3(x + s * 0.5, tall, z + s * 0.5)));
  };
  for (let i = 0, n = 0; i < 5000 && n < 160; i++) {
    const x = rnd(-H + 5, H - 5), z = rnd(-H + 5, H - 5);
    if (keepClear(x, z)) continue;
    placeRock(choose([['rock:0', 4], ['rock:1', 3], ['rock:2', 2], ['rock:3', 1]]), x, z, rnd(0.8, 2.4));
    n++;
  }
  for (let x = -H + 3; x < H - 3; x += rnd(2, 5)) {          // scree along both faces of the ridge
    if (RIDGE_GAPS.some(([g0, g1]) => x > g0 - 2 && x < g1 + 2)) continue;
    const zOff = Math.sin(x * 0.05) * 6;
    for (const side of [1, -1]) {
      const z = RIDGE_Z + zOff + side * rnd(8, 11);
      placeRock(rng() < 0.3 ? 'rock:2' : rng() < 0.5 ? 'rock:1' : 'rock:0', x, z, rnd(0.9, 2.6));
      if (rng() < 0.7) placeRock('rock:4', x + rnd(-1.5, 1.5), z + side * rnd(1, 2.5), rnd(0.4, 0.9), false);
    }
  }
  for (let i = 0, n = 0; i < 3000 && n < 140; i++) {        // creek stones
    const a = CREEK[Math.floor(rng() * (CREEK.length - 1))], b = CREEK[CREEK.indexOf(a) + 1];
    const t = rng(), cx = a[0] + (b[0] - a[0]) * t, cz = a[1] + (b[1] - a[1]) * t;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, side = rng() < 0.5 ? -1 : 1;
    const off = FOREST.creekHalfWidth + rnd(-0.6, 1.4);
    const x = cx + Math.cos(ang) * off * side, z = cz + Math.sin(ang) * off * side;
    if (TRAILS.some((tr) => distToPolyline(x, z, tr) < 2.4)) continue;
    placeRock('rock:4', x, z, rnd(0.35, 1.0), false);
    n++;
  }
  // Re-skin the hand-placed boulder rings (boulder field, Bigfoot's hollow) with kit rocks.
  for (const b of boulderSpots) placeRock(b.s > 1.8 ? 'rock:1' : 'rock:0', b.x, b.z, b.s * 1.9, false);
  // Bigfoot's huge fallen log: the hollow one.
  placeLog('log:3', L.hollow.x + 6, L.hollow.z - 4, 0.7 - Math.PI / 2, 14, 1.4);

  const kitGroup = kit.build(scene);
  const landmarks = landmarkPlan ? buildLandmarks(scene, colliders, landmarkPlan, { heightAt: (x, z) => terrain.heightAt(x, z), rng }) : null;

  // Wind: advance the sway clock from the render loop (no extra hook needed in main).
  const swayer = kitGroup.children.find((c) => c.name.startsWith('kit-fern')) ?? kitGroup.children[0];
  if (swayer) swayer.onBeforeRender = () => { kit.wind.value = performance.now() / 1000; };

  // Texture pass: painted pixel textures on every surface (art #38, docs/art-style-guide.md).
  // #38 texture pass for buildings, rocks, water etc. Its loose moss/grass ground patches are
  // painted into the terrain instead (no overlays).
  dressForest({ meshes: scene.children.slice(firstChild), colors: COLORS, half: H, rng, keepClear });
  for (let k = 0, n = 0; k < 6000 && n < 700; k++) {
    const x = (rng() * 2 - 1) * (H - 2), z = (rng() * 2 - 1) * (H - 2);
    if (keepClear(x, z)) continue;
    terrain.paintDisc({ x, z }, 1.2 + rng() * 2.2, 'moss', { edge: 0.8, wobble: 1.2 }); n++;
  }
  for (let k = 0, n = 0; k < 4000 && n < 500; k++) {
    const x = (rng() * 2 - 1) * (H - 2), z = (rng() * 2 - 1) * (H - 2);
    if (!keepClear(x, z)) continue;
    if (TRAILS.some((t) => distToPolyline(x, z, t) < 2.2)) continue;
    terrain.paintDisc({ x, z }, 1.2 + rng() * 2.2, 'grass', { edge: 1, wobble: 1.2 }); n++;
  }
  ground.material = terrain.material({
    base: { map: leafLitterTexture(), tile: 2 }, grass: { map: grassTexture(), tile: 2 }, moss: { map: mossTexture(), tile: 1 },
    bank: { map: dirtTexture(), tile: 2, tint: 0x8a8078 }, dirt: { map: dirtTexture(), tile: 2 },
  });

  /** 'dry' | 'shallow' — wading the creek (bridge and stones count as dry). */
  const surfaceAt = (x, z, y = 0) => {
    if (y > 0.1) return 'dry';
    return distToPolyline(x, z, creekLine) < FOREST.creekHalfWidth ? 'shallow' : 'dry';
  };
  const speedAt = (x, z, y) => (surfaceAt(x, z, y) === 'shallow' ? FOREST.creekSpeed : 1);

  // Trail signposts at the junctions (#70): the way home is read off the signs, the paper map and
  // the compass; there is no beacon or distance readout.
  const places = Object.entries(PLACE_NAMES).map(([id, name]) => ({ id, name, ...L[id] }));
  const signs = buildTrailSigns(scene, colliders, { trails: TRAILS, places, home: 'trailhead', heightAt: (x, z) => terrain.heightAt(x, z) });

  return {
    colliders,
    bounds: H,
    signs,
    places,
    creek: CREEK.map(([x, z]) => ({ x, z })),
    ridge: { z: RIDGE_Z, gaps: RIDGE_GAPS },
    surfaceAt,
    speedAt,
    trees: trees.length,
    forestKit: kit.stats, // { draws, count } for the instanced foliage and props
    trails: TRAILS,
    heightAt: (x, z) => terrain.heightAt(x, z), // sunken trail ruts: ground height (<= 0) under a point
    terrain,                    // painted ground (#61): terrain.sample(x, z, 'dirt' | 'moss' | 'grass' | 'bank')
    keepClear,                  // open ground (clearings, trails, creek, ridge): used by the atmosphere pass
    playerStart: { x: L.trailhead.x, z: L.trailhead.z, yaw: 0 },
    // Level flow: where the extraction van is parked (walk into its ring to end the hunt) and the
    // zones the hunt picks from at the start of each night (see hunt/levelFlow.js).
    exit: { x: L.trailhead.x + 9, z: L.trailhead.z + 5, name: 'trailhead parking' },
    spawnZones: {
      // Where Bigfoot beds down for the night (one is picked per hunt).
      bigfoot: [
        { name: "Bigfoot's hollow", x: L.hollow.x, z: L.hollow.z, r: 10 },
        { name: 'woods below the lookout', x: L.lookout.x - 14, z: L.lookout.z - 4, r: 8 },
        { name: 'the boulder field', x: L.boulders.x, z: L.boulders.z, r: 9 },
      ],
      // Where its fresh trail starts: it passed through here shortly before you arrived.
      clues: [
        { name: 'the old campsite', x: L.campsite.x - 4, z: L.campsite.z - 6, r: 6 },
        { name: 'behind the cabin', x: L.cabin.x - 20, z: L.cabin.z - 22, r: 6 },
        { name: 'the creek trail', x: 30, z: -8, r: 6 },
      ],
    },
    spawns: { bigfoot: { x: L.hollow.x, z: L.hollow.z } },
    landmarks: { ...L },
    props: landmarks ? { ...landmarks.stats, spots: landmarkPlan.spots, standTop: landmarks.standTop, fence: landmarkPlan.fence } : null,
    // Safe interiors: fear drains fast in here (the van is added by the hunt).
    safeZones: [
      { x: L.cabin.x, z: L.cabin.z, r: 3.6, name: 'cabin' },
      { x: L.campsite.x + 4, z: L.campsite.z - 3, r: 2.2, name: 'tent' },
    ],
    // Night lighting baseline (see maps/nightLighting.js): moon low in the north behind the ridge,
    // so the lookout, ridge and pines read as silhouettes against a glowing horizon.
    environment: { background: 0x070a0d, fog: { color: 0x0b1014, near: 10, far: 60 }, lightLevel: 0.05, night: {} },
  };
}

export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

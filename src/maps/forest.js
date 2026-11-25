import * as THREE from 'three';

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

  // --- Ground ------------------------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ map: floorTexture(H), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'forest-floor';
  scene.add(ground);

  // Trails: flat dirt strips per segment (just above the floor, below clue decals).
  for (const t of TRAILS) for (let i = 0; i < t.length - 1; i++) strip(scene, t[i], t[i + 1], 3, 0.004, mat(COLORS.trail), 'trail');
  for (const [c, r] of CLEARINGS) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r * 0.7, 16), mat(COLORS.trail));
    d.rotation.x = -Math.PI / 2;
    d.position.set(c.x, 0.003, c.z);
    d.receiveShadow = true;
    scene.add(d);
  }

  // --- Creek: water strips along the centre line, with a dark bed edge. -------------------
  for (let i = 0; i < CREEK.length - 1; i++) {
    const a = { x: CREEK[i][0], z: CREEK[i][1] }, b = { x: CREEK[i + 1][0], z: CREEK[i + 1][1] };
    strip(scene, a, b, FOREST.creekHalfWidth * 2 + 1.2, 0.006, mat(COLORS.bed), 'creek-bank');
    strip(scene, a, b, FOREST.creekHalfWidth * 2, 0.06, new THREE.MeshStandardMaterial({
      color: COLORS.water, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, depthWrite: false,
    }), 'creek');
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

  // --- Boulder field. -----------------------------------------------------------------------
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, d = 3 + rng() * 8, s = 1 + rng() * 2.2;
    const bx = L.boulders.x + Math.cos(a) * d, bz = L.boulders.z + Math.sin(a) * d;
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s), mat(rng() < 0.5 ? COLORS.rock : COLORS.rockDark));
    b.position.set(bx, s * 0.6, bz);
    b.castShadow = b.receiveShadow = true;
    b.name = 'boulder';
    scene.add(b);
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
    rotBox(x + 6, z - 4, 1.4, 14, 0, 1.4, 0.7, COLORS.snag, { name: 'fallen-log' });
    const nest = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.45, 5, 10), mat(0x3b2a1c));
    nest.rotation.x = -Math.PI / 2;
    nest.position.set(x - 3, 0.25, z + 2);
    nest.name = 'bigfoot-nest';
    scene.add(nest);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, s = 1.2 + rng() * 1.3;
      const bx = x + Math.cos(a) * 13, bz = z + Math.sin(a) * 13;
      if (Math.abs(a - Math.PI * 0.5) < 0.6) continue; // opening toward the south trail
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s), mat(COLORS.rockDark));
      b.position.set(bx, s * 0.6, bz);
      b.castShadow = true;
      scene.add(b);
      colliders.push(new THREE.Box3(new THREE.Vector3(bx - s * 0.8, 0, bz - s * 0.8), new THREE.Vector3(bx + s * 0.8, s * 1.4, bz + s * 0.8)));
    }
  }

  // --- Trees: instanced pines (trunk + two needle cones) and some dead snags. -------------
  const keepClear = (x, z) => {
    for (const [c, r] of CLEARINGS) if (Math.hypot(x - c.x, z - c.z) < r) return true;
    for (const t of TRAILS) if (distToPolyline(x, z, t) < 3.2) return true;
    if (distToPolyline(x, z, CREEK.map(([px, pz]) => ({ x: px, z: pz }))) < FOREST.creekHalfWidth + 1.5) return true;
    if (Math.abs(z - RIDGE_Z) < 17) return true; // ridge and its shoulders
    return false;
  };
  const trees = [];
  const SP = 6.2; // jittered grid spacing
  for (let gx = -H + 4; gx < H - 4; gx += SP) {
    for (let gz = -H + 4; gz < H - 4; gz += SP) {
      const x = gx + (rng() - 0.5) * SP * 0.8, z = gz + (rng() - 0.5) * SP * 0.8;
      if (keepClear(x, z)) continue;
      trees.push({ x, z, r: 0.22 + rng() * 0.3, h: 9 + rng() * 9, snag: rng() < 0.07, rot: rng() * Math.PI });
    }
  }
  const pines = trees.filter((t) => !t.snag), snags = trees.filter((t) => t.snag);
  const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7); coneGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(COLORS.bark), trees.length);
  const lowCones = new THREE.InstancedMesh(coneGeo, mat(COLORS.needles), pines.length);
  const highCones = new THREE.InstancedMesh(coneGeo, mat(COLORS.needlesDark), pines.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (im, i, x, y, z, sx, sy, sz, rot) => {
    q.setFromAxisAngle(up, rot);
    im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)));
  };
  trees.forEach((t, i) => {
    put(trunks, i, t.x, 0, t.z, t.r, t.snag ? t.h * 0.7 : t.h, t.r, t.rot);
    colliders.push(new THREE.Box3(new THREE.Vector3(t.x - t.r, 0, t.z - t.r), new THREE.Vector3(t.x + t.r, t.h, t.z + t.r)));
  });
  pines.forEach((t, i) => {
    const w = 1.8 + t.h * 0.12;
    put(lowCones, i, t.x, t.h * 0.22, t.z, w, t.h * 0.55, w, t.rot);
    put(highCones, i, t.x, t.h * 0.55, t.z, w * 0.7, t.h * 0.5, w * 0.7, t.rot + 1);
  });
  for (const im of [trunks, lowCones, highCones]) {
    im.castShadow = im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    scene.add(im);
  }
  trunks.name = 'tree-trunks'; lowCones.name = 'tree-canopy-low'; highCones.name = 'tree-canopy-high';
  // Snags get a couple of bare limbs.
  for (const t of snags) {
    for (let k = 0; k < 2; k++) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.4 + rng() * 1.5), mat(COLORS.snag));
      const a = rng() * Math.PI * 2;
      limb.position.set(t.x + Math.sin(a) * 0.6, t.h * (0.4 + rng() * 0.25), t.z + Math.cos(a) * 0.6);
      limb.rotation.set(-0.6, a, 0);
      scene.add(limb);
    }
  }

  // Ferns / undergrowth (dressing, no collision).
  const fernGeo = new THREE.ConeGeometry(0.5, 0.5, 5);
  const ferns = new THREE.InstancedMesh(fernGeo, mat(0x2f4a2a), 900);
  let nf = 0;
  for (let i = 0; i < 3000 && nf < 900; i++) {
    const x = (rng() * 2 - 1) * (H - 3), z = (rng() * 2 - 1) * (H - 3);
    if (keepClear(x, z) && rng() < 0.85) continue;
    const s = 0.5 + rng() * 0.8;
    put(ferns, nf++, x, 0.2 * s, z, s * 1.2, s * 0.8, s * 1.2, rng() * 6);
  }
  ferns.count = nf;
  ferns.instanceMatrix.needsUpdate = true;
  ferns.computeBoundingSphere();
  ferns.name = 'ferns';
  scene.add(ferns);

  const creekLine = CREEK.map(([x, z]) => ({ x, z }));
  /** 'dry' | 'shallow' — wading the creek (bridge and stones count as dry). */
  const surfaceAt = (x, z, y = 0) => {
    if (y > 0.1) return 'dry';
    return distToPolyline(x, z, creekLine) < FOREST.creekHalfWidth ? 'shallow' : 'dry';
  };
  const speedAt = (x, z, y) => (surfaceAt(x, z, y) === 'shallow' ? FOREST.creekSpeed : 1);

  return {
    colliders,
    bounds: H,
    surfaceAt,
    speedAt,
    trees: trees.length,
    trails: TRAILS,
    playerStart: { x: L.trailhead.x, z: L.trailhead.z, yaw: 0 },
    spawns: { bigfoot: { x: L.hollow.x, z: L.hollow.z } },
    landmarks: { ...L },
    environment: { background: 0x070a0d, fog: { color: 0x0b1014, near: 10, far: 60 } },
  };
}

// Flat strip from a to b (width w) lying on the ground at height y.
function strip(scene, a, b, w, y, material, name) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len + w * 0.6), material);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2, Math.atan2(b.x - a.x, b.z - a.z), 0);
  m.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  m.receiveShadow = true;
  m.name = name;
  scene.add(m);
  return m;
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

// Mottled forest-floor texture (nearest-filtered so it reads as pixels up close).
function floorTexture(H) {
  const n = 16, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const r = mulberry32(5);
  const shades = ['#2b3324', '#283021', '#30382a', '#262b20', '#2f3326'];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = shades[Math.floor(r() * shades.length)]; g.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(H / 4, H / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

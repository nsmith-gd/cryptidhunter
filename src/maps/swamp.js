import * as THREE from 'three';

// Blackwater Swamp — greybox (L0).
// Layout (north = -z): spawn dock in the south, a boardwalk spine running north to a central
// mud island, branches west to the ranger shack and east to a fishing platform, then the old
// bridge (the landmark) arching over the deep channel to the north platform, Mothman's haunt.
// Everything off the boardwalks is water: shallow water slows you, the deep channel slows you
// a lot more. Boardwalks/islands are low solid boxes the player steps onto (top at DECK).

export const SWAMP = {
  half: 50,               // map is 100 x 100 m
  water: 0.3,             // water surface height (bed is y = 0)
  deck: 0.34,             // top of boardwalks and mud islands
  step: 0.3,              // bridge stair rise
  shallowSpeed: 0.6,      // speed multiplier wading in shallow water
  deepSpeed: 0.35,        // speed multiplier in the deep channel / pools
};

// Deep water areas [x0, z0, x1, z1].
const DEEP = [
  [-50, -26, 50, -16],    // the channel the bridge crosses
  [-42, 24, -22, 42],     // black pool south-west of the shack
  [26, 8, 44, 30],        // east backwater
];

const COLORS = {
  plank: 0x7a7266, plankDark: 0x5e574e, mud: 0x3b3428, bed: 0x231f18,
  shallow: 0x3a4a3a, deep: 0x0c1410, wood: 0x4a4038, tree: 0x37322c, wall: 0x1a1d1a, rail: 0x8a8070,
};

export function buildSwampMap(scene) {
  const colliders = [];
  const decks = [];         // walkable dry tops (AABBs), for the connectivity check
  const mats = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
    return mats.get(key);
  };
  const H = SWAMP.half;

  // Box from (x0,z0)-(x1,z1), y from y0 to y1. collide=false for pure dressing.
  const slab = (x0, z0, x1, z1, y0, y1, color, { collide = true, deck = false, name } = {}) => {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (name) m.name = name;
    scene.add(m);
    if (collide) {
      const b = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
      colliders.push(b);
      if (deck) decks.push(b);
    }
    return m;
  };
  const D = SWAMP.deck;
  // Boardwalk: plank deck plus a post every ~3 m along both long edges.
  const walk = (x0, z0, x1, z1, name) => {
    const m = slab(x0, z0, x1, z1, 0, D, COLORS.plank, { deck: true, name });
    m.material = plankMat(x1 - x0, z1 - z0);
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let t = 0; t <= len + 0.01; t += 3) {
      for (const side of [0, 1]) {
        const px = alongX ? x0 + t : (side ? x1 : x0);
        const pz = alongX ? (side ? z1 : z0) : z0 + t;
        slab(px - 0.09, pz - 0.09, px + 0.09, pz + 0.09, 0, D + 0.25, COLORS.wood, { collide: false });
      }
    }
    return m;
  };
  const island = (x0, z0, x1, z1) => slab(x0, z0, x1, z1, 0, D, COLORS.mud, { deck: true });

  // --- Water: mud bed, shallow sheet over the whole map, darker deep areas. -----------------
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(COLORS.bed, { roughness: 1 }));
  bed.rotation.x = -Math.PI / 2;
  bed.receiveShadow = true;
  scene.add(bed);
  const waterMat = (color, opacity) => new THREE.MeshStandardMaterial({
    color, roughness: 0.15, metalness: 0.1, transparent: true, opacity, depthWrite: false,
  });
  const shallow = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), waterMat(COLORS.shallow, 0.82));
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.y = SWAMP.water;
  shallow.receiveShadow = true;
  shallow.name = 'water-shallow';
  scene.add(shallow);
  for (const [x0, z0, x1, z1] of DEEP) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), waterMat(COLORS.deep, 0.95));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, SWAMP.water + 0.005, (z0 + z1) / 2);
    m.receiveShadow = true;
    m.name = 'water-deep';
    scene.add(m);
  }

  // --- Perimeter: dark treeline walls. ------------------------------------------------------
  slab(-H, -H - 1, H, -H, 0, 6, COLORS.wall);
  slab(-H, H, H, H + 1, 0, 6, COLORS.wall);
  slab(-H - 1, -H, -H, H, 0, 6, COLORS.wall);
  slab(H, -H, H + 1, H, 0, 6, COLORS.wall);

  // --- Boardwalk network. ------------------------------------------------------------------
  walk(-3, 38, 3, 45, 'spawn-dock');            // spawn dock (south)
  walk(-1, 20, 1, 38, 'south-spine');
  walk(-4, 14, 4, 20, 'junction');               // central junction
  walk(-24, 16, -4, 18, 'west-walk');
  walk(-33, 9, -24, 23, 'shack-platform');      // ranger shack platform
  walk(4, 16, 20, 18, 'east-walk');
  walk(18, -2, 20, 16, 'east-north-walk');
  walk(14, -9, 24, -2, 'fishing-platform');     // east fishing platform
  walk(-1, 2, 1, 14, 'north-spine');
  island(-7, -10, 7, 2);                          // central mud island the bridge lifts off from

  // Ranger shack: walls with a doorway facing east, roof on top.
  const sx0 = -31, sx1 = -25, sz0 = 12, sz1 = 18, sh = D + 2.6;
  slab(sx0, sz0, sx1, sz0 + 0.2, D, sh, COLORS.wood);           // north wall
  slab(sx0, sz1 - 0.2, sx1, sz1, D, sh, COLORS.wood);           // south wall
  slab(sx0, sz0, sx0 + 0.2, sz1, D, sh, COLORS.wood);           // west wall
  slab(sx1 - 0.2, sz0, sx1, 14, D, sh, COLORS.wood);            // east wall, door gap z 14..16
  slab(sx1 - 0.2, 16, sx1, sz1, D, sh, COLORS.wood);
  slab(sx1 - 0.2, 14, sx1, 16, D + 2.1, sh, COLORS.wood);       // lintel
  slab(sx0 - 0.4, sz0 - 0.4, sx1 + 0.4, sz1 + 0.4, sh, sh + 0.25, COLORS.plankDark, { name: 'shack-roof' });

  // Fishing platform dressing: crates and an upturned skiff in the shallows.
  slab(20, -8, 21.2, -6.8, D, D + 0.8, COLORS.plankDark);
  slab(21.4, -8, 22.4, -7, D, D + 0.6, COLORS.plankDark);
  slab(26, -5, 27.4, 0, 0, 0.55, COLORS.wood, { name: 'skiff' });

  // A broken boardwalk running west from the island: it stops short, forcing a wade.
  walk(-22, -4, -7, -2, 'broken-walk');
  walk(-34, -4, -27, -2, 'broken-walk-far');
  slab(-26.5, -4.2, -23, -1.8, -0.3, 0.12, COLORS.plankDark, { collide: false }); // sunken planks

  // --- The old bridge (landmark) over the deep channel. ------------------------------------
  // Stairs up from the island (south), a raised deck clear of the water, stairs down north.
  const S = SWAMP.step, steps = 7, run = 0.5, bw = 1.5;   // bridge half-width
  const top = D + S * steps;                               // deck top height
  const zSouth = -10, zDeck0 = zSouth - steps * run;       // -13.5
  const zDeck1 = -28.5, zNorth = zDeck1 - steps * run;     // -32
  for (let i = 1; i <= steps; i++) {
    slab(-bw, zSouth - i * run, bw, zSouth - (i - 1) * run, 0, D + S * i, COLORS.plank, { deck: true });
    slab(-bw, zDeck1 - (steps - i + 1) * run, bw, zDeck1 - (steps - i) * run, 0, D + S * i, COLORS.plank, { deck: true });
  }
  const deck = slab(-bw, zDeck1, bw, zDeck0, top - 0.3, top, COLORS.plank, { deck: true, name: 'bridge-deck' });
  deck.material = plankMat(bw * 2, zDeck0 - zDeck1);
  for (const x of [-bw - 0.1, bw]) slab(x, zDeck1, x + 0.1, zDeck0, top, top + 1.0, COLORS.rail);   // railings
  for (const z of [-17, -21, -25]) for (const x of [-bw + 0.1, bw - 0.5]) {
    slab(x, z - 0.2, x + 0.4, z + 0.2, 0, top - 0.3, COLORS.wood);                                 // piers
  }
  // Tall end towers and an overhead truss so the bridge reads from across the swamp.
  for (const z of [zDeck0 - 0.5, zDeck1 + 0.1]) {
    for (const x of [-bw - 0.5, bw + 0.1]) slab(x, z, x + 0.4, z + 0.4, 0, top + 4, COLORS.wood);
    slab(-bw - 0.5, z, bw + 0.5, z + 0.4, top + 3.5, top + 4, COLORS.wood, { collide: false });
  }
  slab(-bw - 0.5, zDeck1 + 0.1, -bw - 0.1, zDeck0 - 0.1, top + 3.5, top + 3.8, COLORS.wood, { collide: false });
  slab(bw + 0.1, zDeck1 + 0.1, bw + 0.5, zDeck0 - 0.1, top + 3.5, top + 3.8, COLORS.wood, { collide: false });
  // Warning lamps on the towers: the bridge glows through the mist.
  for (const z of [zDeck0 - 0.3, zDeck1 + 0.3]) {
    const lamp = new THREE.PointLight(0xff7a3a, 6, 18, 1.6);
    lamp.position.set(0, top + 3.2, z);
    scene.add(lamp);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0xffa060 }));
    bulb.position.copy(lamp.position);
    scene.add(bulb);
  }

  walk(-1, -40, 1, zNorth, 'north-walk');
  walk(-7, -47, 7, -40, 'north-platform');      // Mothman's haunt
  // Derelict water tower on the north platform.
  for (const [x, z] of [[-3, -46], [2, -46], [-3, -42], [2, -42]]) slab(x, z, x + 0.4, z + 0.4, D, D + 6, COLORS.wood);
  slab(-3.6, -46.6, 3, -41, D + 6, D + 9, COLORS.plankDark, { name: 'water-tower' });

  // Dry hummocks in the open water (stepping spots / cover).
  island(-16, 28, -10, 33);
  island(10, 26, 16, 31);
  island(-40, -36, -30, -30);
  island(28, -40, 38, -32);

  // --- Dead cypress trees: trunks (solid) with a few bare limbs. -------------------------
  const rng = mulberry32(7);
  const nearDeck = (x, z, pad) => decks.some((b) => x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad);
  let placed = 0;
  for (let i = 0; i < 400 && placed < 70; i++) {
    const x = (rng() * 2 - 1) * (H - 3), z = (rng() * 2 - 1) * (H - 3);
    if (nearDeck(x, z, 2.5) || Math.abs(x) < 3 && z > -34 && z < -8) continue;
    const r = 0.25 + rng() * 0.35, h = 5 + rng() * 7;
    tree(x, z, r, h);
    placed++;
  }
  function tree(x, z, r, h) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 1.8, h, 6), mat(COLORS.tree));
    trunk.position.set(x, h / 2, z);
    trunk.castShadow = trunk.receiveShadow = true;
    scene.add(trunk);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r)));
    for (let k = 0; k < 3; k++) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.5 + rng() * 2), mat(COLORS.tree));
      const a = rng() * Math.PI * 2, y = h * (0.55 + rng() * 0.4);
      limb.position.set(x + Math.sin(a) * 0.8, y, z + Math.cos(a) * 0.8);
      limb.rotation.set(-0.5 - rng() * 0.4, a, 0);
      limb.castShadow = true;
      scene.add(limb);
    }
    // Cypress knees poking out of the water.
    for (let k = 0; k < 3; k++) {
      const knee = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5 + rng() * 0.3, 4), mat(COLORS.tree));
      knee.position.set(x + (rng() - 0.5) * 2.5, 0.35, z + (rng() - 0.5) * 2.5);
      scene.add(knee);
    }
  }
  tree(4, -4, 0.5, 10);    // the island's big dead tree

  // Reeds: thin dressing clumps at the water's edge (no collision).
  for (let i = 0; i < 160; i++) {
    const x = (rng() * 2 - 1) * (H - 2), z = (rng() * 2 - 1) * (H - 2);
    if (nearDeck(x, z, 0.3)) continue;
    const h = 0.6 + rng() * 0.8;
    const reed = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), mat(0x4a5236));
    reed.position.set(x, h / 2, z);
    reed.rotation.z = (rng() - 0.5) * 0.3;
    scene.add(reed);
  }

  /** What the player is standing in at (x, z, feetY): 'dry' | 'shallow' | 'deep'. */
  const surfaceAt = (x, z, y = 0) => {
    if (y > SWAMP.water - 0.1) return 'dry';
    for (const [x0, z0, x1, z1] of DEEP) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return 'deep';
    return 'shallow';
  };
  const speedAt = (x, z, y) => ({ dry: 1, shallow: SWAMP.shallowSpeed, deep: SWAMP.deepSpeed })[surfaceAt(x, z, y)];

  return {
    colliders,
    bounds: H,
    decks,
    surfaceAt,
    speedAt,
    playerStart: { x: 0, z: 42, yaw: 0 },
    spawns: {
      mothman: { x: 0, z: -21 },          // circles over the bridge
    },
    landmarks: {
      spawnDock: { x: 0, z: 42 }, junction: { x: 0, z: 17 }, shack: { x: -28, z: 15 },
      fishing: { x: 19, z: -5 }, island: { x: 0, z: -4 }, bridgeTop: { x: 0, z: -21 },
      northPlatform: { x: 0, z: -44 },
    },
    environment: { background: 0x0a100d, fog: { color: 0x0f1712, near: 6, far: 38 } },
  };
}

// Plank texture so boardwalks read as walkable wood and speed is readable underfoot.
function plankMat(w, d) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 8;
  const g = c.getContext('2d');
  const shades = ['#7a7266', '#6e675c', '#81786b', '#655e54'];
  for (let y = 0; y < 8; y++) { g.fillStyle = shades[y % 4]; g.fillRect(0, y, 4, 1); }
  g.fillStyle = '#3d3830'; for (let y = 0; y < 8; y += 2) g.fillRect(0, y, 4, 0.5);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  // Planks run across the walkway.
  const alongX = w > d;
  if (alongX) { t.rotation = Math.PI / 2; t.repeat.set(d / 2, w / 2); } else t.repeat.set(w / 2, d / 2);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

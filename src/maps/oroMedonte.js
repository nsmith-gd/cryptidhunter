import * as THREE from 'three';
import { ForestKit } from '../art/forestKit.js';
import { buildTrailSigns } from './trailSigns.js';
import { ribbonGeometry } from './terrainPainter.js';
import { ramp } from '../art/palette.js';
import { distToPolyline } from './forest.js';

// Level 2: Oro-Medonte woodland (GDD 6.2 L02, 12 "trailhead, hill loops and recognizable ridges",
// G03 gym space; #129). A short daylight trip from the parked car into rolling hardwood-and-pine
// hills that are easy to get turned around in:
//   south   the parked car at the trailhead (start and extraction: walk up to it, E or H)
//   middle  rolling hills and two ridges; one trail only, car -> lower campsite; everything else
//           is off-trail. A stream runs down from the north-east into the lake.
//   east    the lake shore (shore point: water to drink and refill, and a wide view across)
//   north   the upper campsite, the Gouger's den under the north ridge, and the feeding meadow
//           on the south-facing slope (with a camera post overlooking it)
// Hills are real: the ground rises up to ~16 m, so uphill walking costs effort, the slopes slow
// you, and sprinting down a steep slope can twist an ankle (minor terrain injury, S08).
// Map, compass, the one trail and the ridges are how you find your way back before dusk.

export const ORO = {
  half: 180,
  hillHeight: 16,
  lake: { x: 120, z: -10, r: 46, level: -1.2 },
  flatAround: [],          // filled below: spots kept level for props
  dusk: { startMin: 14 * 60 + 30, endMin: 19 * 60 + 40, seconds: 20 * 60, label: 'dusk' },   // 2:30 PM -> 7:40 PM
};

const L = {
  car: { x: -10, z: 150 },
  lowerCamp: { x: -60, z: 70 },
  upperCamp: { x: 40, z: -105 },
  den: { x: -45, z: -140 },
  meadow: { x: -10, z: -85 },
  cameraPost: { x: 14, z: -70 },
  shore: { x: 76, z: 10 },
  westRidge: { x: -120, z: 0 },
};
export const ORO_PLACES = { car: 'Car', lowerCamp: 'Lower campsite', upperCamp: 'Upper campsite', shore: 'Lake shore', meadow: 'Meadow', den: 'Rock den' };
const TRAIL = [L.car, { x: -14, z: 128 }, { x: -30, z: 104 }, { x: -52, z: 86 }, L.lowerCamp];
const STREAM = [{ x: 100, z: -170 }, { x: 92, z: -120 }, { x: 78, z: -80 }, { x: 82, z: -45 }, { x: 96, z: -22 }];

// Each spot kept level (radius, flat to ground height there): car park at 0.
const FLAT = [[L.car, 18, 0], [L.lowerCamp, 9], [L.upperCamp, 9], [L.den, 7], [L.shore, 6], [L.cameraPost, 2.5]];

/** Raw hills: two east-west ridges, a valley, random knolls, sloping down to the lake in the east. */
function rawHeight(x, z) {
  const H = ORO.hillHeight;
  let h = 0;
  h += H * 0.8 * Math.exp(-(((z + 125) / 32) ** 2)) * (0.75 + 0.25 * Math.sin(x / 37));       // north ridge
  h += H * 0.55 * Math.exp(-(((z - 20 + 12 * Math.sin(x / 29)) / 26) ** 2));                  // middle ridge
  h += H * 0.45 * Math.exp(-((((x + 120) / 30) ** 2) + ((z / 70) ** 2)));                     // west ridge
  h += 2.2 * Math.sin(x / 23 + 1.3) * Math.cos(z / 19 - 0.4) + 1.4 * Math.sin((x + z) / 13);    // knolls
  const lk = ORO.lake, d = Math.hypot(x - lk.x, z - lk.z);
  const toLake = Math.max(0, Math.min(1, (d - lk.r) / 40));                                      // shore slope
  return h * toLake + (1 - toLake) * lk.level;
}

export function oroHeight(x, z) {
  let h = rawHeight(x, z);
  for (const [p, r, level] of FLAT) {
    const d = Math.hypot(x - p.x, z - p.z), k = Math.max(0, Math.min(1, (d - r) / (r * 0.8)));
    const target = level ?? rawHeight(p.x, p.z);
    h = target + (h - target) * k;
  }
  return h;
}

export function buildOroMedonteMap(scene) {
  const H = ORO.half;
  const colliders = [];
  const rng = mulberry32(2002);
  const heightAt = oroHeight;
  // Colliders run from y = 0 to the object's top above the ground (so the nav grid and the
  // player both see them on hills).
  const solid = (x0, z0, x1, z1, top) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, Math.min(0, heightAt((x0 + x1) / 2, (z0 + z1) / 2)) - 1, z0), new THREE.Vector3(x1, top, z1)));

  // --- Ground: one low-poly sheet, flat-shaded, coloured by height and slope from the palette ---
  const seg = 180;
  const geo = new THREE.PlaneGeometry(H * 2, H * 2, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), grass = [ramp('grass', 2), ramp('grass', 3), ramp('moss', 3)], dirt = ramp('dirt', 3), rock = ramp('rock', 3), sand = ramp('dirt', 5);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z);
    pos.setY(i, y);
    const slope = Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
    const lk = Math.hypot(x - ORO.lake.x, z - ORO.lake.z) - ORO.lake.r;
    const onTrail = distToPolyline(x, z, TRAIL) < 2.2;
    c.set(lk < 4 ? sand : onTrail ? dirt : slope > 0.45 ? rock : grass[(Math.floor(x / 7) + Math.floor(z / 9) + i) % 3]);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  ground.receiveShadow = true;
  ground.name = 'oro-terrain';
  scene.add(ground);

  // --- Lake and stream -------------------------------------------------------------------------
  const lake = new THREE.Mesh(new THREE.CircleGeometry(ORO.lake.r + 4, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: ramp('water', 4), roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.88 }));
  lake.position.set(ORO.lake.x, ORO.lake.level + 0.55, ORO.lake.z);
  lake.name = 'lake';
  scene.add(lake);
  const streamPts = STREAM.map((p) => ({ x: p.x, z: p.z }));
  const stream = new THREE.Mesh(ribbonGeometry(streamPts, 3, 0, 4), new THREE.MeshStandardMaterial({ color: ramp('water', 4), roughness: 0.15, transparent: true, opacity: 0.85, depthWrite: false }));
  // Drape the ribbon on the hills.
  { const p = stream.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + 0.06); p.needsUpdate = true; }
  stream.name = 'stream';
  scene.add(stream);
  // Deep water is out of bounds (you can wade the shallows to drink and refill).
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2, x = ORO.lake.x + Math.cos(t) * (ORO.lake.r - 7), z = ORO.lake.z + Math.sin(t) * (ORO.lake.r - 7);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 4, -3, z - 4), new THREE.Vector3(x + 4, 1.5, z + 4)));
  }

  // --- Trees: mixed pine and bare hardwood, dense off-trail; young pines fill the understory ----
  const clear = (x, z) => distToPolyline(x, z, TRAIL) < 3.5 || FLAT.some(([p, r]) => Math.hypot(x - p.x, z - p.z) < r + 2)
    || Math.hypot(x - ORO.lake.x, z - ORO.lake.z) < ORO.lake.r + 3 || distToPolyline(x, z, STREAM) < 3
    || Math.hypot(x - L.meadow.x, z - L.meadow.z) < 22;
  const kit = new ForestKit(2002);
  const pineKeys = kit.variants('pine'), youngKeys = kit.variants('youngPine');
  const rnd = (a, b) => a + rng() * (b - a);
  let trees = 0;
  const SP = 5.6;
  for (let gx = -H + 4; gx < H - 4; gx += SP) for (let gz = -H + 4; gz < H - 4; gz += SP) {
    const x = gx + (rng() - 0.5) * SP * 0.85, z = gz + (rng() - 0.5) * SP * 0.85;
    if (clear(x, z)) continue;
    const y = heightAt(x, z), h = rnd(9, 19), r = rnd(0.22, 0.5);
    const snag = rng() < 0.18;             // bare hardwoods and dead snags between the pines
    if (snag) kit.add(rng() < 0.5 ? 'snag:0' : 'snag:1', x, y, z, rng() * 6.28, [h * 0.9, h * 0.85, h * 0.9]);
    else {
      const v = rnd(0.7, 1), warm = rnd(-0.04, 0.1);
      kit.add(pineKeys[Math.floor(rng() * pineKeys.length)], x, y, z, rng() * 6.28, [h * rnd(0.85, 1.1), h, h * rnd(0.85, 1.1)],
        { x: rnd(-0.04, 0.04), z: rnd(-0.04, 0.04) }, new THREE.Color(v * (1 + warm), v, v * (1 - warm)));
    }
    solid(x - r, z - r, x + r, z + r, y + h);
    trees++;
  }
  for (let i = 0, n = 0; i < 4000 && n < 700; i++) {
    const x = rnd(-H + 4, H - 4), z = rnd(-H + 4, H - 4);
    if (clear(x, z)) continue;
    const y = heightAt(x, z);
    kit.add(youngKeys[Math.floor(rng() * youngKeys.length)], x, y, z, rng() * 6.28, rnd(2.4, 5.5));
    n++;
  }
  for (let i = 0, n = 0; i < 9000 && n < 2200; i++) {
    const x = rnd(-H + 3, H - 3), z = rnd(-H + 3, H - 3);
    if (distToPolyline(x, z, TRAIL) < 1.6 || Math.hypot(x - ORO.lake.x, z - ORO.lake.z) < ORO.lake.r) continue;
    const inMeadow = Math.hypot(x - L.meadow.x, z - L.meadow.z) < 22;
    const key = inMeadow ? (rng() < 0.7 ? 'grass:1' : 'grass:0') : rng() < 0.5 ? 'fern:0' : rng() < 0.5 ? 'bush:0' : 'grass:0';
    kit.add(key, x, heightAt(x, z), z, rng() * 6.28, rnd(0.8, 1.5));
    n++;
  }
  // Boulders on the steep ridges (the den is a rock overhang under the north ridge).
  for (let i = 0, n = 0; i < 3000 && n < 90; i++) {
    const x = rnd(-H + 6, H - 6), z = rnd(-H + 6, H - 6);
    if (clear(x, z)) continue;
    const slope = Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1));
    if (slope < 0.6) continue;
    const s = rnd(0.8, 2.2), y = heightAt(x, z);
    kit.add(`rock:${Math.floor(rng() * 4)}`, x, y, z, rng() * 6.28, s);
    solid(x - s * 0.8, z - s * 0.8, x + s * 0.8, z + s * 0.8, y + s * 1.3);
    n++;
  }
  kit.build(scene);

  // --- Landmarks -------------------------------------------------------------------------------
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const at = (m, x, z, dy = 0) => { m.position.set(x, heightAt(x, z) + dy, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  // Two campsites: a fire ring, a log bench and a tent pad each.
  const campsite = (p, name) => {
    const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.18, 5, 10).rotateX(Math.PI / 2), mat(ramp('rock', 3))), p.x, p.z, 0.12);
    ring.name = `${name}-firering`;
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 7).rotateZ(Math.PI / 2), mat(ramp('wood', 3))), p.x + 2.4, p.z + 0.5, 0.3);
    const tent = at(new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.7, 4), mat(ramp('litter', 4))), p.x - 3, p.z - 2.5, 0.85);
    tent.rotation.y = Math.PI / 4;
    solid(p.x - 4.3, p.z - 3.8, p.x - 1.7, p.z - 1.2, heightAt(p.x, p.z) + 1.7);
  };
  campsite(L.lowerCamp, 'lower-camp'); campsite(L.upperCamp, 'upper-camp');
  // The car: a parked hatchback at the trailhead (the hunt's extraction van sits beside it).
  // Den: a rock overhang with a flattened bed of grass.
  const denRock = at(new THREE.Mesh(new THREE.BoxGeometry(7, 3, 4), mat(ramp('rock', 2))), L.den.x, L.den.z - 3.5, 1.5);
  denRock.name = 'gouger-den';
  solid(L.den.x - 3.5, L.den.z - 5.5, L.den.x + 3.5, L.den.z - 1.5, heightAt(L.den.x, L.den.z) + 3);
  at(new THREE.Mesh(new THREE.CircleGeometry(1.8, 9).rotateX(-Math.PI / 2), mat(ramp('grass', 5))), L.den.x, L.den.z, 0.04).name = 'den-bed';
  // Camera post: a waist-high stake looking down into the meadow (best spot for a trail camera).
  const post = at(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), mat(ramp('wood', 4))), L.cameraPost.x, L.cameraPost.z, 0.65);
  post.name = 'camera-post';
  const flag = at(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.18), new THREE.MeshStandardMaterial({ color: ramp('warm', 3), side: THREE.DoubleSide })), L.cameraPost.x + 0.2, L.cameraPost.z, 1.2);
  flag.name = 'camera-post-flag';
  // Shore point: a flat granite slab at the water's edge.
  at(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.6, 8), mat(ramp('rock', 4))), L.shore.x, L.shore.z, 0.2).name = 'shore-slab';

  const places = Object.entries(ORO_PLACES).map(([id, name]) => ({ id, name, ...L[id] }));
  const signs = buildTrailSigns(scene, colliders, { trails: [TRAIL], places: places.filter((p) => p.id === 'car' || p.id === 'lowerCamp'), home: 'car', heightAt });

  const lk = ORO.lake;
  const surfaceAt = (x, z, y = heightAt(x, z)) => {
    const d = Math.hypot(x - lk.x, z - lk.z);
    if (d < lk.r - 2) return y < lk.level + 0.6 ? 'deep' : 'dry';
    if (d < lk.r + 3 || distToPolyline(x, z, STREAM) < 1.6) return 'shallow';
    return 'dry';
  };
  // Slopes slow you (and make you work harder: the player's terrain factor reads this).
  const speedAt = (x, z, y) => {
    if (surfaceAt(x, z, y) === 'shallow') return 0.65;
    const g = Math.hypot(heightAt(x + 0.8, z) - heightAt(x - 0.8, z), heightAt(x, z + 0.8) - heightAt(x, z - 0.8)) / 1.6;
    return Math.max(0.55, 1 - g * 0.9);
  };
  const slopeAt = (x, z) => Math.hypot(heightAt(x + 0.8, z) - heightAt(x - 0.8, z), heightAt(x, z + 0.8) - heightAt(x, z - 0.8)) / 1.6;

  return {
    colliders, bounds: H, signs, places, trails: [TRAIL], creek: STREAM, creekName: 'Bass Creek', lake: { ...lk, name: 'Bass Lake' },
    surfaceAt, speedAt, slopeAt, heightAt, trees,
    keepClear: (x, z) => clear(x, z),
    terrainInjury: true,          // sprinting on steep ground can twist an ankle (S08, light)
    clock: ORO.dusk,              // daylight to dusk: be back at the car by 7:40 PM
    daylight: true,
    level: 2,
    playerStart: { x: L.car.x + 3, z: L.car.z - 6, yaw: 0 },
    exit: { x: L.car.x - 5, z: L.car.z, name: 'the car at the trailhead' },
    campsites: [{ ...L.lowerCamp, r: 4, name: 'campfire (lower campsite)' }, { ...L.upperCamp, r: 4, name: 'campfire (upper campsite)' }],
    spawnZones: {
      gouger: [{ name: 'the rock den', x: L.den.x, z: L.den.z + 5, r: 6 }, { name: 'the feeding meadow', x: L.meadow.x, z: L.meadow.z, r: 12 }],
      clues: [{ name: 'the middle ridge', x: -30, z: 25, r: 10 }, { name: 'above the lower campsite', x: -60, z: 40, r: 8 }],
    },
    spawns: { gouger: { x: L.meadow.x, z: L.meadow.z } },
    landmarks: { ...L },
    safeZones: [{ x: L.car.x - 5, z: L.car.z, r: 3, name: 'the car' }],
    environment: { background: 0x8aa39a, fog: { color: 0x8aa39a, near: 30, far: 160 }, lightLevel: 0.6, night: dayGrade() },
  };
}

/** Afternoon grade for the daylight start (palette colours); the hunt eases it toward dusk and night. */
export function dayGrade() {
  return {
    moonColor: ramp('warm', 5), moonIntensity: 2.0, moonDir: [0.55, 0.75, 0.35],
    ambientSky: ramp('water', 6), ambientGround: ramp('moss', 2), ambientIntensity: 1.25,
    fogColor: ramp('water', 5), fogDensity: 0.011, skyHorizon: ramp('lichen', 3), skyZenith: ramp('water', 5), moonGlow: ramp('warm', 5),
    flashlightBoost: 1,
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

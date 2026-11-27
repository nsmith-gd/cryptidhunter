import * as THREE from 'three';
import { ForestKit } from '../art/forestKit.js';
import { ramp } from '../art/palette.js';
import { distToPolyline } from './forest.js';

// Level 9: the Pine Barrens, NJ (L0 greybox, #147; GDD 1.5 L09, 5.4, 12.2 "dense pines, clearings,
// canopy gaps and nest zone"). Flat sandy ground under pitch pines. What matters is the sky:
//   canopy   most of the map is under pine crowns: the Jersey Devil can't see you there
//   clearings big open sand barrens: exposed from the air
//   gaps     small holes in the canopy along the sand road and in the woods: briefly exposed
//   rock     old iron-furnace ruins and a sandstone outcrop: its sight is blocked behind them
//   nest     a stand of dead snags in the north, ringed by open ground: where it roosts
//   camp     the remote road camp in the south (start and the van out), under the trees
// map.coverAt(x, z) -> 0..1 overhead cover (1: under canopy) is what its sight reads.

export const BARRENS = { half: 150, cell: 2, crown: 3.4 };

const L = {
  roadCamp: { x: 0, z: 128 },
  bigBarren: { x: -40, z: 30 },
  eastBarren: { x: 70, z: -10 },
  furnace: { x: 20, z: 60 },
  outcrop: { x: -70, z: -50 },
  nest: { x: 10, z: -105 },
  bog: { x: 85, z: 70 },
};
export const BARRENS_PLACES = { roadCamp: 'Road camp', bigBarren: 'The big barren', eastBarren: 'East barren', furnace: 'Furnace ruins', outcrop: 'Sandstone outcrop', nest: 'Dead pines (nest)', bog: 'Cedar bog' };
const ROAD = [L.roadCamp, { x: 6, z: 95 }, { x: -10, z: 60 }, { x: -20, z: 40 }, L.bigBarren, { x: -30, z: -20 }, { x: -5, z: -70 }, { x: 10, z: -88 }];
// Open sky: [centre, radius].
const CLEARINGS = [[L.bigBarren, 24], [L.eastBarren, 18], [L.nest, 20], [L.bog, 14], [L.furnace, 12], [L.outcrop, 14]];   // the ruins and the outcrop stand in the open: rock is the only cover there
const GAPS = [[{ x: -14, z: 82 }, 5], [{ x: 40, z: 25 }, 6], [{ x: -60, z: 70 }, 5], [{ x: 50, z: -60 }, 6], [{ x: -50, z: -95 }, 5], [{ x: -22, z: -48 }, 5], [{ x: 95, z: 20 }, 5]];

export function buildPineBarrensMap(scene) {
  const H = BARRENS.half;
  const colliders = [];
  const rng = mulberry32(909);
  const rnd = (a, b) => a + rng() * (b - a);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  const solid = (x0, z0, x1, z1, top) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, top, z1)));

  // Sandy ground, the sand road paler.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2).rotateX(-Math.PI / 2), mat(ramp('dirt', 4)));
  ground.receiveShadow = true; ground.name = 'barrens-ground'; scene.add(ground);
  for (let i = 0; i < ROAD.length - 1; i++) {
    const a = ROAD[i], b = ROAD[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(4, len + 4).rotateX(-Math.PI / 2), mat(ramp('dirt', 6)));
    seg.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2); seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); seg.name = 'sand-road';
    scene.add(seg);
  }
  for (const [c, r] of CLEARINGS) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2), mat(ramp('dirt', 5)));
    d.position.set(c.x, 0.01, c.z); d.name = 'barren'; scene.add(d);
  }

  const open = (x, z) => CLEARINGS.some(([c, r]) => Math.hypot(x - c.x, z - c.z) < r) || GAPS.some(([c, r]) => Math.hypot(x - c.x, z - c.z) < r)
    || distToPolyline(x, z, ROAD) < 2.6 || Math.hypot(x - L.roadCamp.x, z - L.roadCamp.z) < 9;

  // Pitch pines, close together so their crowns make a roof; scrub oak under them.
  const kit = new ForestKit(909);
  const pine = kit.variants('pine'), young = kit.variants('youngPine');
  const trees = [];
  const SP = 4.2;
  for (let gx = -H + 3; gx < H - 3; gx += SP) for (let gz = -H + 3; gz < H - 3; gz += SP) {
    const x = gx + (rng() - 0.5) * SP * 0.8, z = gz + (rng() - 0.5) * SP * 0.8;
    if (open(x, z)) continue;
    const h = rnd(9, 15), r = rnd(0.16, 0.3);
    kit.add(pine[Math.floor(rng() * pine.length)], x, 0, z, rng() * 6.28, [h * rnd(1.0, 1.3), h, h * rnd(1.0, 1.3)], { x: rnd(-0.05, 0.05), z: rnd(-0.05, 0.05) }, new THREE.Color(0.75, 0.82, 0.7));
    solid(x - r, z - r, x + r, z + r, h);
    trees.push({ x, z });
  }
  for (let i = 0, n = 0; i < 4000 && n < 900; i++) {
    const x = rnd(-H + 2, H - 2), z = rnd(-H + 2, H - 2);
    if (distToPolyline(x, z, ROAD) < 2) continue;
    kit.add(rng() < 0.5 ? 'bush:0' : young[Math.floor(rng() * young.length)], x, 0, z, rng() * 6.28, rnd(0.8, 1.6));
    n++;
  }
  // The nest: a stand of tall dead snags in the northern clearing, with a stick nest in the tallest.
  const perches = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, x = L.nest.x + Math.cos(a) * rnd(5, 11), z = L.nest.z + Math.sin(a) * rnd(5, 11), h = rnd(13, 18);
    kit.add(i % 2 ? 'snag:0' : 'snag:1', x, 0, z, rng() * 6.28, [h, h, h]);
    solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3, h);
    perches.push({ x, z, y: h - 1.2 });
  }
  const nestMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.9, 0.9, 9), mat(ramp('wood', 2)));
  nestMesh.position.set(perches[0].x, perches[0].y + 0.6, perches[0].z); nestMesh.name = 'devil-nest'; scene.add(nestMesh);
  // Rock: the iron-furnace ruins (a broken stack and walls) and a sandstone outcrop.
  const rock = [];
  const block = (x, z, w, d, h, color, name) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; m.name = name; scene.add(m);
    solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h);
    rock.push(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)));
  };
  block(L.furnace.x, L.furnace.z, 5, 5, 9, ramp('rock', 3), 'furnace-stack');
  block(L.furnace.x + 6, L.furnace.z + 2, 8, 1.2, 3.2, ramp('rock', 2), 'furnace-wall');
  block(L.furnace.x - 4, L.furnace.z + 6, 1.2, 7, 2.6, ramp('rock', 2), 'furnace-wall');
  block(L.outcrop.x, L.outcrop.z, 12, 7, 5, ramp('lichen', 1), 'sandstone-outcrop');
  block(L.outcrop.x + 5, L.outcrop.z + 6, 6, 5, 3.5, ramp('lichen', 0), 'sandstone-outcrop');
  // Camp: a lean-to and a fire ring at the road camp (under the trees, but its fire lights the sky).
  block(L.roadCamp.x - 6, L.roadCamp.z - 4, 3, 2, 1.6, ramp('wood', 3), 'camp-leanto');
  kit.build(scene);

  // Overhead cover grid: 1 under the pine crowns, 0 under open sky.
  const n = Math.ceil((H * 2) / BARRENS.cell), cover = new Uint8Array(n * n);
  for (const t of trees) {
    const r = BARRENS.crown, i0 = Math.floor((t.x - r + H) / BARRENS.cell), i1 = Math.floor((t.x + r + H) / BARRENS.cell);
    const j0 = Math.floor((t.z - r + H) / BARRENS.cell), j1 = Math.floor((t.z + r + H) / BARRENS.cell);
    for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
      const cx = -H + (i + 0.5) * BARRENS.cell, cz = -H + (j + 0.5) * BARRENS.cell;
      if (Math.hypot(cx - t.x, cz - t.z) <= r) cover[j * n + i] = 1;
    }
  }
  const coverAt = (x, z) => {
    if (open(x, z)) return 0;
    const i = Math.floor((x + H) / BARRENS.cell), j = Math.floor((z + H) / BARRENS.cell);
    return i < 0 || j < 0 || i >= n || j >= n ? 0 : cover[j * n + i];
  };
  /** Does rock block the line between two points (its sight)? */
  const rockBlocks = (a, b) => {
    const ray = new THREE.Ray(a.clone(), b.clone().sub(a).normalize()), len = a.distanceTo(b), hit = new THREE.Vector3();
    return rock.some((r) => ray.intersectBox(r, hit) && hit.distanceTo(a) < len - 0.5);
  };

  const places = Object.entries(BARRENS_PLACES).map(([id, name]) => ({ id, name, ...L[id] }));
  return {
    colliders, bounds: H, places, trails: [ROAD], trees: trees.length,
    coverAt, rockBlocks, perches, nest: { ...L.nest, r: 20 }, clearings: CLEARINGS.map(([c, r]) => ({ ...c, r })), gaps: GAPS.map(([c, r]) => ({ ...c, r })),
    noBigfoot: true, level: 9, keepClear: open,
    playerStart: { x: L.roadCamp.x + 3, z: L.roadCamp.z - 4, yaw: 0 },
    exit: { x: L.roadCamp.x - 2, z: L.roadCamp.z + 6, name: 'the road camp' },
    landmarks: { ...L, campsite: { x: L.roadCamp.x - 4, z: L.roadCamp.z - 7 } },
    safeZones: [{ x: L.roadCamp.x - 6, z: L.roadCamp.z - 4, r: 2.4, name: 'lean-to' }],
    environment: { background: 0x070a0d, fog: { color: 0x0b1014, near: 10, far: 90 }, lightLevel: 0.05, night: {} },
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

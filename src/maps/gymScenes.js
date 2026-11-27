import * as THREE from 'three';

// Gameplay gyms G02–G04 (GDD 15.1–15.2; task #108). Greybox test spaces, not campaign content:
// plain shapes, controlled daylight-dusk lighting and a fixed seed. Each one isolates a group of
// systems; gym/gymKit.js adds the debug HUD, event trace, blind mode and pass criteria, and
// gym/proxies.js the creature proxies. Load with ?map=g02 | g03 | g04 (fixed seed unless ?seed=).
//
//   G02 Physiology and traversal: short and long routes to a goal, a stepped slope, a wet
//       crossing (wading, no swimming), a dry rest shelter, a water source, light and heavy pack
//       stations, food and first-aid crates. No creature, camp or fatigue pressure.
//   G03 Naturalist search and camp: a woodland loop round a hill with a contour-following proxy,
//       its den and feeding area, an ordinary-animal false trace, two campsites, a pond with a
//       shore observation point. No combat.
//   G04 Territory, pursuit and withdrawal: a woodland fork, a defended zone with a visible
//       warning cue, a safe edge route, two hiding spots and the extraction point; a territorial
//       proxy and a scent-pursuit proxy (either can be switched off with ?proxy=).

export const GYM_SEEDS = { gym: 77, g02: 202, g03: 303, g04: 404, g05: 505 };

function kit(scene) {
  const colliders = [];
  const mats = new Map();
  const mat = (color, extra = {}) => {
    const k = `${color}${JSON.stringify(extra)}`;
    if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
    return mats.get(k);
  };
  const box = (x0, z0, x1, z1, y0, y1, color = 0x7a7a7a, { collide = true, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat(color));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (name) m.name = name;
    scene.add(m);
    if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const floor = (half, color = 0x4a5040) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), mat(color));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; g.name = 'gym-floor';
    scene.add(g);
    box(-half, -half - 1, half, -half, 0, 3, 0x3a3a3a); box(-half, half, half, half + 1, 0, 3, 0x3a3a3a);
    box(-half - 1, -half, -half, half, 0, 3, 0x3a3a3a); box(half, -half, half + 1, half, 0, 3, 0x3a3a3a);
  };
  const flat = (x, z, w, d, color, name, y = 0.01) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.name = name;
    scene.add(m);
    return m;
  };
  /** A greybox tree: trunk collider + a cone. */
  const tree = (x, z, h = 7) => {
    box(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, h * 0.45, 0x5a4636, { name: 'gym-trunk' });
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.6, h * 0.7, 6), mat(0x2f4a32));
    c.position.set(x, h * 0.65, z); c.castShadow = true; c.name = 'gym-canopy';
    scene.add(c);
  };
  /** A sign: a post and a lettered board facing +z (texts are for testers). */
  const sign = (x, z, text, ry = 0) => {
    box(x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, 1.7, 0x6a5a40, { name: 'gym-sign-post' });
    const c = document.createElement('canvas'); c.width = 128; c.height = 40;
    const g = c.getContext('2d'); g.fillStyle = '#e8e0c8'; g.fillRect(0, 0, 128, 40);
    g.fillStyle = '#222'; g.font = 'bold 14px monospace'; g.textAlign = 'center';
    const lines = String(text).split('\n');
    lines.forEach((l, i) => g.fillText(l, 64, 22 - (lines.length - 1) * 8 + i * 16));
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
    b.position.set(x, 1.55, z); b.rotation.y = ry; b.name = 'gym-sign';
    scene.add(b);
  };
  const light = (x, y, z, color = 0xfff0d0, i = 5, d = 16) => {
    const l = new THREE.PointLight(color, i, d, 1.6); l.position.set(x, y, z); scene.add(l); return l;
  };
  return { colliders, box, floor, flat, tree, sign, light, mat };
}

const dusk = { background: 0x1a2230, fog: { color: 0x2a3444, near: 25, far: 90 }, lightLevel: 0.35, airTemp: 8 };

// ---- G02 -------------------------------------------------------------------------------------
export function buildGymG02(scene) {
  const K = kit(scene), H = 30;
  K.floor(H);
  // Wet crossing across the middle (z −2..2): shallow water, wading only.
  const water = K.flat(0, 0, H * 2, 4, 0x2a4a58, 'g02-wet-crossing', 0.03);
  water.material = new THREE.MeshStandardMaterial({ color: 0x2a4a58, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  // Short route: straight north over a stepped slope (0.3 m steps up to 1.5 m and down again).
  K.flat(0, 12, 3, 22, 0x6a5a44, 'g02-short-route');
  K.flat(0, -13, 3, 20, 0x6a5a44, 'g02-short-route');
  for (let i = 0; i < 5; i++) K.box(-1.5, -8 - i * 1.2, 1.5, -9.2 - i * 1.2, 0, 0.3 * (i + 1), 0x7a6a52, { name: 'g02-slope-up' });
  for (let i = 0; i < 5; i++) K.box(-1.5, -14 - i * 1.2, 1.5, -15.2 - i * 1.2, 0, 1.5 - 0.3 * i, 0x7a6a52, { name: 'g02-slope-down' });
  // Long route: a flat loop round the west side.
  K.flat(-18, 0, 3, 46, 0x6a5a44, 'g02-long-route');
  K.flat(-9, 23, 18, 3, 0x6a5a44, 'g02-long-route'); K.flat(-9, -23, 18, 3, 0x6a5a44, 'g02-long-route');
  // Dry rest shelter (east of the start): roof on posts, a stove.
  K.box(14, 16, 22, 16.2, 2.6, 2.8, 0x5a5a5a, { collide: false, name: 'g02-shelter-roof' });
  const roof = K.box(14, 16, 22, 22, 2.6, 2.75, 0x5a5a5a, { collide: false, name: 'g02-shelter-roof' }); void roof;
  for (const [x, z] of [[14, 16], [22, 16], [14, 22], [22, 22]]) K.box(x - 0.1, z - 0.1, x + 0.1, z + 0.1, 0, 2.6, 0x6a5a40);
  K.box(17.6, 18.6, 18.4, 19.4, 0, 0.8, 0x2a2a2a, { name: 'g02-stove' });
  K.light(18, 1.4, 19, 0xff9a50, 4, 9);
  K.sign(18, 15.5, 'DRY REST\nSHELTER');
  // Water source by the crossing (west): a spring box. Supplies at the start.
  K.box(-8.5, 3, -7.5, 4, 0, 0.9, 0x4a6a7a, { name: 'g02-water-source' }); K.sign(-8, 5, 'WATER\nSOURCE');
  K.box(3, 25, 4.2, 26, 0, 0.6, 0x8a6a3a, { name: 'g02-food-crate' }); K.sign(3.6, 27, 'FOOD');
  K.box(-4.2, 25, -3, 26, 0, 0.6, 0xa03a3a, { name: 'g02-first-aid-crate' }); K.sign(-3.6, 27, 'FIRST AID');
  // Pack stations: light (5 kg) and heavy (20 kg).
  K.flat(-6, 20, 2, 2, 0x8aa070, 'g02-pack-light'); K.sign(-6, 21.6, 'PACK 5 kg');
  K.flat(6, 20, 2, 2, 0xa07060, 'g02-pack-heavy'); K.sign(6, 21.6, 'PACK 20 kg');
  K.flat(0, -26, 4, 2, 0xd0c060, 'g02-goal'); K.sign(0, -27.5, 'GOAL');
  K.light(0, 4, -26, 0xfff0d0, 3, 12);
  const surfaceAt = (x, z, y = 0) => (y > 0.1 ? 'dry' : Math.abs(z) < 2 ? 'shallow' : 'dry');
  return {
    colliders: K.colliders, bounds: H, gym: 'G02', title: 'G02 Physiology and traversal', noBigfoot: true,
    playerStart: { x: 0, z: 24, yaw: 0 }, exit: { x: 0, z: -26, name: 'the goal' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] },
    surfaceAt, speedAt: (x, z, y) => (surfaceAt(x, z, y) === 'shallow' ? 0.6 : 1),
    safeZones: [{ x: 18, z: 19, r: 3.6, name: 'rest shelter' }],
    landmarks: { start: { x: 0, z: 24 }, goal: { x: 0, z: -26 }, slope: { x: 0, z: -14 }, crossing: { x: 0, z: 0 }, longWest: { x: -18, z: 0 },
      shelter: { x: 18, z: 19 }, water: { x: -8, z: 3.5 }, food: { x: 3.6, z: 25.5 }, firstAid: { x: -3.6, z: 25.5 }, packLight: { x: -6, z: 20 }, packHeavy: { x: 6, z: 20 } },
    environment: { ...dusk },
  };
}

// ---- G03 -------------------------------------------------------------------------------------
/** The hill's contour the G03 proxy follows: an ellipse round (0, -4). */
export function g03Contour(t) {
  return { x: Math.cos(t) * 14, z: -4 + Math.sin(t) * 9 };
}

export function buildGymG03(scene) {
  const K = kit(scene), H = 36;
  K.floor(H, 0x3e4a36);
  // The hill: stepped plateaus in the middle (the proxy keeps to its 14 × 9 m contour around it).
  for (let i = 0; i < 4; i++) K.box(-9 + i * 2, -10 + i * 1.4, 9 - i * 2, 2 - i * 1.4, 0, 0.3 * (i + 1), 0x56603e, { name: 'g03-hill' });
  // Loop trail round the outside of the contour.
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    K.flat(Math.cos(t) * 22, -4 + Math.sin(t) * 16, 2.6, 2.6, 0x6a5a44, 'g03-loop-trail', 0.012);
  }
  // Trees scattered between the loop and the contour (a fixed layout: the fixture).
  for (const [x, z] of [[-17, -14], [-19, 4], [-12, 12], [17, -14], [19, 5], [11, 12], [-6, -19], [7, -20], [0, 15], [-24, -8], [24, -2], [-14, -24], [15, -25]]) K.tree(x, z);
  // Den and feeding area (north of the contour).
  K.box(-2, -22, 2, -20.5, 0, 1.2, 0x4a4036, { name: 'g03-den' }); K.sign(0, -18.6, 'DEN');
  K.flat(6, -15, 4, 3, 0x5a4a2a, 'g03-feeding-area'); K.sign(6, -12.8, 'FEEDING');
  // Two campsites (tent pads), west and east.
  K.flat(-28, 10, 4, 4, 0x7a6a52, 'g03-campsite-west'); K.sign(-28, 12.6, 'CAMP A');
  K.flat(28, 10, 4, 4, 0x7a6a52, 'g03-campsite-east'); K.sign(28, 12.6, 'CAMP B');
  // Pond with a shore observation point (south-east).
  const pond = K.flat(20, 26, 12, 7, 0x2a4a58, 'g03-pond', 0.03);
  pond.material = new THREE.MeshStandardMaterial({ color: 0x2a4a58, roughness: 0.1, metalness: 0.3 });
  K.box(12, 21.5, 15, 23.5, 0, 0.3, 0x7a6a52, { name: 'g03-observation-point' }); K.sign(13.5, 24.4, 'SHORE\nOBSERVATION');
  K.light(-28, 2.5, 10, 0xffa060, 3, 10); K.light(28, 2.5, 10, 0xffa060, 3, 10);
  const surfaceAt = (x, z, y = 0) => (y > 0.1 ? 'dry' : Math.abs(x - 20) < 6 && Math.abs(z - 26) < 3.5 ? 'shallow' : 'dry');
  return {
    colliders: K.colliders, bounds: H, gym: 'G03', title: 'G03 Naturalist search and camp', noBigfoot: true,
    playerStart: { x: 0, z: 30, yaw: 0 }, exit: { x: 0, z: 31, name: 'the trailhead' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] },
    surfaceAt, speedAt: (x, z, y) => (surfaceAt(x, z, y) === 'shallow' ? 0.6 : 1),
    safeZones: [{ x: -28, z: 10, r: 2.5, name: 'camp A' }, { x: 28, z: 10, r: 2.5, name: 'camp B' }],
    landmarks: { start: { x: 0, z: 30 }, den: { x: 0, z: -21 }, feeding: { x: 6, z: -15 }, campWest: { x: -28, z: 10 }, campEast: { x: 28, z: 10 },
      observation: { x: 13.5, z: 22.5 }, pond: { x: 20, z: 26 }, falseTrace: { x: -14, z: 22 } },
    environment: { ...dusk, lightLevel: 0.3 },
  };
}

// ---- G04 -------------------------------------------------------------------------------------
export const G04 = { home: { x: -12, z: -8 }, warnR: 15, coreR: 7, extraction: { x: 14, z: -26 }, fork: { x: 0, z: 12 }, den: { x: 18, z: 6 } };

export function buildGymG04(scene) {
  const K = kit(scene), H = 30;
  K.floor(H, 0x3e4a36);
  // The fork: the trail from the start splits at (0, 12): NW into the defended zone, NE along the safe edge.
  K.flat(0, 20, 3, 16, 0x6a5a44, 'g04-trail');
  for (let i = 0; i <= 10; i++) { const t = i / 10; K.flat(0 - 12 * t, 12 - 20 * t, 3, 3, 0x6a5a44, 'g04-trail-nw', 0.012); }
  // Safe edge route: east from the fork to x = 16, then north to the extraction, well outside the warning ring.
  for (let i = 0; i <= 6; i++) K.flat((16 * i) / 6, 12, 3, 3, 0x6a5a44, 'g04-trail-safe-edge', 0.012);
  for (let i = 0; i <= 12; i++) K.flat(16, 12 - (38 * i) / 12, 3, 3, 0x6a5a44, 'g04-trail-safe-edge', 0.012);
  // The defended zone: a ring of claw-marked stumps and a scatter of bones as the visible warning cue.
  for (let a = 0; a < 10; a++) {
    const t = (a / 10) * Math.PI * 2, x = G04.home.x + Math.cos(t) * G04.warnR, z = G04.home.z + Math.sin(t) * G04.warnR;
    K.box(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0, 1.1, 0x6a4a30, { name: 'g04-warning-stump' });
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), new THREE.MeshStandardMaterial({ color: 0xd8c7a6, emissive: 0x3a2a10, roughness: 0.7 }));
    s.position.set(x, 0.75, z); s.name = 'g04-claw-marks'; scene.add(s);
  }
  K.sign(-2, 6, 'FRESH CLAW\nMARKS AHEAD', -0.6);
  K.box(G04.home.x - 2, G04.home.z - 1.5, G04.home.x + 2, G04.home.z + 1.5, 0, 0.6, 0x4a4036, { name: 'g04-lair' });
  // Two hiding spots: a rock blind and a dense thicket.
  K.box(-4, -1, -1, 0.5, 0, 1.9, 0x5a5a5a, { name: 'g04-hide-rock' }); K.sign(-2.5, 1.4, 'HIDE A');
  K.box(9, -6, 12, -4.5, 0, 2.1, 0x2a4a2a, { name: 'g04-hide-thicket' }); K.sign(10.5, -3.6, 'HIDE B');
  for (const [x, z] of [[8, 18], [-10, 18], [22, -12], [-22, 10], [18, 20], [-24, -20], [6, -18]]) K.tree(x, z);
  K.flat(G04.extraction.x, G04.extraction.z, 4, 3, 0xd0c060, 'g04-extraction'); K.sign(G04.extraction.x, G04.extraction.z - 2, 'EXTRACTION');
  K.light(G04.extraction.x, 3, G04.extraction.z, 0xfff0d0, 3, 10);
  K.box(G04.den.x - 1.2, G04.den.z - 1.2, G04.den.x + 1.2, G04.den.z + 1.2, 0, 0.9, 0x403630, { name: 'g04-scent-den' });
  return {
    colliders: K.colliders, bounds: H, gym: 'G04', title: 'G04 Territory, pursuit and withdrawal', noBigfoot: true,
    playerStart: { x: 0, z: 26, yaw: 0 }, exit: { ...G04.extraction, name: 'the extraction point' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] },
    surfaceAt: () => 'dry', speedAt: () => 1,
    safeZones: [],
    landmarks: { start: { x: 0, z: 26 }, fork: G04.fork, home: G04.home, extraction: G04.extraction, hideA: { x: -2.5, z: -0.2 }, hideB: { x: 10.5, z: -5.2 }, den: G04.den },
    environment: { ...dusk, lightLevel: 0.3 },
  };
}

import * as THREE from 'three';
import { TIMI, surfaceAt, boatWater, shoreTrail } from './timiskamingLayout.js';

// Lake Timiskaming — greybox (L0) for L05, the Mugwump (GDD 1.5, 12.2 card 05; task #139). Flat
// shore ground, a dark main basin with two bays and a pale wadeable rim, the shore hub (dock, rental
// shed, heated warming hut, lamp), the road out (the land exit), a ring of trail posts on dry ground
// all the way round, and plain cone trees for scale. The rental boat and the water traversal rules
// are in src/water/ (main.js creates them for any map that sets `water`). Open with ?map=l05
// (&storm for wind, rain and waves).

export function buildTimiskamingMap(scene) {
  const H = TIMI.half, colliders = [];
  const root = new THREE.Group(); root.name = 'timiskaming'; scene.add(root);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
  const box = (x, z, w, d, h, color, { collide = true, y0 = 0, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; if (name) m.name = name;
    root.add(m);
    if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x3a4232));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'shore-ground'; root.add(ground);
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 4, 0x2a2e28, { name: 'edge' });

  // Water: each basin is a pale shallow rim ellipse with a dark deep ellipse inside it.
  for (const b of TIMI.basins) {
    const ell = (rx, rz, color, y, name, extra) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 56), mat(color, extra));
      m.scale.set(rx, rz, 1); m.rotation.x = -Math.PI / 2; m.position.set(b.x, y, b.z); m.name = name; m.receiveShadow = true;
      root.add(m); return m;
    };
    ell(b.rx + 1.2, b.rz + 1.2, 0x5a5440, 0.01, `beach-${b.id}`);
    ell(b.rx, b.rz, 0x35606a, 0.02, `shallows-${b.id}`, { roughness: 0.25, metalness: 0.2 });
    ell(b.rx - TIMI.shallow, b.rz - TIMI.shallow, 0x10283a, 0.03, `deep-${b.id}`, { roughness: 0.1, metalness: 0.35 });
  }

  // Shore hub: the dock out to the mooring, the rental shed, the heated warming hut, a lamp post.
  const d = TIMI.dock;
  box((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2, d.x1 - d.x0, d.z1 - d.z0, 0.25, 0x7a5a3a, { collide: false, y0: 0.05, name: 'dock' });
  for (const [px, pz] of [[d.x0, d.z0], [d.x1, d.z0], [d.x0, (d.z0 + d.z1) / 2], [d.x1, (d.z0 + d.z1) / 2]]) box(px, pz, 0.25, 0.25, 0.9, 0x5a4028, { collide: false, name: 'dock-post' });
  box(TIMI.shed.x, TIMI.shed.z, 5, 4, 3, 0x6a6a58, { name: 'rental-shed' });
  box(TIMI.shed.x, TIMI.shed.z - 2.05, 3.2, 0.1, 0.7, 0xd8c070, { collide: false, y0: 2.1, name: 'rental-sign' });
  box(TIMI.hut.x, TIMI.hut.z, 4, 3.5, 2.6, 0x7a4a36, { name: 'warming-hut' });
  box(TIMI.generator.x, TIMI.generator.z, 1.4, 1, 1.1, 0xb08a2a, { name: 'shed-generator' });   // the charging station (#140)
  const hutGlow = new THREE.PointLight(0xffa060, 4, 10, 1.4); hutGlow.position.set(TIMI.hut.x, 1.6, TIMI.hut.z - 2.2); root.add(hutGlow);
  box(3, 11, 0.2, 0.2, 3.4, 0x333333, { name: 'lamp-post' });
  const lamp = new THREE.PointLight(0xfff0d0, 6, 22, 1.5); lamp.position.set(3, 3.4, 10.5); root.add(lamp);
  // The road out: a gravel strip from the hub to the land exit, and the exit sign.
  const road = (x0, z0, x1, z1, w) => { const len = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat(0x66625a)); m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(x1 - x0, z1 - z0); m.position.set((x0 + x1) / 2, 0.015, (z0 + z1) / 2); m.name = 'road'; root.add(m); };
  road(0, 12, TIMI.start.x, TIMI.start.z, 4); road(TIMI.start.x, TIMI.start.z, TIMI.exit.x, TIMI.exit.z, 4);
  box(TIMI.exit.x, TIMI.exit.z + 2.5, 3.4, 0.3, 2.6, 0xd0c060, { collide: false, name: 'exit-sign' });
  // Shore trail posts (dry ground all the way round) and a sign for each bay.
  const trail = shoreTrail();
  trail.forEach((p, i) => { if (i % 3 === 0) box(p.x, p.z, 0.3, 0.3, 1.1, 0xb8a070, { collide: false, name: 'trail-post' }); });
  for (const b of TIMI.basins.slice(1)) {
    const far = trail.reduce((best, p) => (Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? p : best));
    box(far.x, far.z, 1.8, 0.15, 1.0, 0xe0e0d0, { collide: false, y0: 1.2, name: `sign-${b.id}` });
  }
  // Trees for scale: a deterministic scatter on dry ground, clear of the hub, road and trail.
  let seed = 505; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trunkMat = mat(0x3a2a1c), leafMat = mat(0x1e3022);
  for (let i = 0; i < 420; i++) {
    const x = (rnd() * 2 - 1) * (H - 4), z = (rnd() * 2 - 1) * (H - 4);
    if (surfaceAt(x, z) !== 'dry' || boatWater(x, z)) continue;
    if (trail.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
    if (Math.hypot(x - 2, z - 22) < 22 || Math.hypot(x - TIMI.exit.x, z - TIMI.exit.z) < 8) continue;
    if (TIMI.basins.some((b) => ((x - b.x) / (b.rx + 6)) ** 2 + ((z - b.z) / (b.rz + 6)) ** 2 < 1)) continue;
    const h = 5 + rnd() * 5;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, h * 0.35, 5), trunkMat); t.position.set(x, h * 0.175, z);
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.4 + rnd(), h * 0.8, 6), leafMat); c.position.set(x, h * 0.35 + h * 0.4, z); c.castShadow = true;
    root.add(t, c);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.3, 0, z - 0.3), new THREE.Vector3(x + 0.3, 3, z + 0.3)));
  }

  const storm = typeof location !== 'undefined' && new URLSearchParams(location.search).has('storm');
  return {
    colliders, bounds: H, surfaceAt, noBigfoot: true, level: 5,
    speedAt: (x, z, y) => ({ dry: 1, shallow: 0.6, deep: 0.4 })[surfaceAt(x, z, y)],
    playerStart: { x: TIMI.start.x, z: TIMI.start.z, yaw: 0 },
    exit: { x: TIMI.exit.x, z: TIMI.exit.z, name: TIMI.exit.name },
    safeZones: [{ x: TIMI.hut.x, z: TIMI.hut.z, r: 3.2, name: 'warming hut' }],
    landmarks: { start: TIMI.start, hut: TIMI.hut, shed: TIMI.shed, generator: TIMI.generator, mooring: TIMI.mooring, exit: TIMI.exit },
    places: [{ id: 'trailhead', name: 'Shore hub', x: TIMI.start.x, z: TIMI.start.z }, { id: 'hut', name: 'Warming hut', x: TIMI.hut.x, z: TIMI.hut.z },
      ...TIMI.basins.map((b) => ({ id: b.id, name: b.name.replace(/^the /, 'The '), x: b.x, z: b.z }))],
    trails: [[...trail, trail[0]]],
    shoreTrail: trail,
    spawns: {}, keepClear: [],
    // The water: a rental boat at the mooring; where it can float; the shared traversal rules.
    water: { boat: { ...TIMI.mooring }, boatWater, storm: storm ? 1 : 0 },
    // Power (#140): the shed generator charges what's plugged in at the shed and at the mooring.
    power: { generator: TIMI.generator, shed: TIMI.shed, mooring: TIMI.mooring },
    environment: storm
      ? { background: 0x0c121a, fog: { color: 0x141c26, near: 12, far: 70 }, lightLevel: 0.16, airTemp: 5, rain: 1 }
      : { background: 0x121c2a, fog: { color: 0x1a2636, near: 25, far: 140 }, lightLevel: 0.3, airTemp: 8 },
  };
}

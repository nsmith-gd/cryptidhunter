import * as THREE from 'three';

// Cobalt behaviour gym (#133; L04 Old Yellow Top greybox): a small remote woodland with three paths
// (the logging road, the ridge path, the creek path), a camp clearing and two trail-camera sites.
// ?map=cobaltgym. Old Yellow Top starts on the logging road.

export const COBALT = {
  half: 50,
  routes: [
    { id: 'road', name: 'the logging road', pts: [[-40, -30], [-10, -32], [20, -30], [40, -28]] },
    { id: 'ridge', name: 'the ridge path', pts: [[-40, 0], [-15, 4], [15, 2], [40, 6]] },
    { id: 'creek', name: 'the creek path', pts: [[-40, 28], [-12, 24], [14, 30], [40, 26]] },
  ],
  camp: { x: -6, z: 14 },
  camSites: [{ x: -20, z: 40 }, { x: 22, z: 40 }],
  start: { x: 0, z: 44 },
};

export function buildCobaltGym(scene) {
  const colliders = [];
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const H = COBALT.half;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x34402a)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const box = (x, z, w, d, h, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m); colliders.push(new THREE.Box3().setFromObject(m)); };
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 3, 0x2a2a2a);
  const segD = (x, z, a, b) => { const abx = b[0] - a[0], abz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz))); return Math.hypot(x - a[0] - abx * t, z - a[1] - abz * t); };
  const onPath = (x, z) => COBALT.routes.some((r) => r.pts.slice(1).some((b, i) => segD(x, z, r.pts[i], b) < 3));
  for (const r of COBALT.routes) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s <= L; s += 2) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), mat(0x5a4a34)); p.rotation.x = -Math.PI / 2; p.position.set(ax + (bx - ax) * s / L, 0.01, az + (bz - az) * s / L); scene.add(p); }
  }
  let seed = 404; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = (rnd() * 2 - 1) * (H - 2), z = (rnd() * 2 - 1) * (H - 2);
    if (onPath(x, z) || Math.hypot(x - COBALT.camp.x, z - COBALT.camp.z) < 8 || Math.abs(z - 40) < 6 || Math.hypot(x, z - 44) < 6) continue;
    box(x, z, 0.5, 0.5, 8, 0x2a221a);
  }
  return {
    colliders, bounds: H, noBigfoot: true, level: 4,
    playerStart: { x: COBALT.start.x, z: COBALT.start.z, yaw: 0 }, exit: { x: 0, z: 47, name: 'the truck' },
    spawns: { oldyellowtop: { x: -40, z: -30 } },
    oytRoutes: COBALT.routes, camSites: COBALT.camSites,
    landmarks: { camp: COBALT.camp, camA: COBALT.camSites[0], camB: COBALT.camSites[1] },
    environment: { background: 0x0c1014, fog: { color: 0x141a20, near: 18, far: 80 }, lightLevel: 0.25, airTemp: 6 },
  };
}

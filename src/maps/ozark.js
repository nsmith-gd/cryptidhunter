import * as THREE from 'three';
import {
  OZARK, heightAt, creekZ, inCreek, isOpen, ROUTES, SIDE_TRAILS, ROAD, TRAILHEAD, EXIT, JUNCTION, CAMPS, DEN, CARCASSES,
  planTrees, planCliffs, distToPolyline,
} from './ozarkLayout.js';

// Ozark Mountains — greybox (L0) for L07, the Ozark Howler (GDD §1.5, §12.2). Built from the pure
// layout in ozarkLayout.js: flat-coloured ridge-and-valley terrain (forest floor, bare crest
// grass and rock, worn trails, the creek), oak and pine stand-ins, cliff bands, camp pads, route
// signs at the valley junction, and a deer carcass that gives off scent all night (#143).
// Open with ?map=ozark (a scent-following Howler proxy dens on Bald Knob).

const WATER_Y = -0.5;
const COL = {
  floor: new THREE.Color(0x3a3324), open: new THREE.Color(0x5a5a3a), rock: new THREE.Color(0x6a655c),
  trail: new THREE.Color(0x6e5a40), road: new THREE.Color(0x6e6a64), bed: new THREE.Color(0x2e2a22),
};

export function buildOzarkMap(scene) {
  const H = OZARK.half;
  const root = new THREE.Group();
  root.name = 'ozark';
  scene.add(root);
  const colliders = [];
  const solid = (x0, z0, x1, z1, y0, y1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));

  // ---- terrain ------------------------------------------------------------------------------------
  const seg = 200;
  const geo = new THREE.PlaneGeometry(2 * H, 2 * H, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  const lines = [...Object.values(ROUTES).map((r) => r.pts), ...SIDE_TRAILS];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
    pos.setY(i, h);
    if (h < WATER_Y + 0.1) c.copy(COL.bed);
    else if (distToPolyline(x, z, ROAD) < 2.2 || Math.hypot(x - TRAILHEAD.x, z - TRAILHEAD.z) < 7) c.copy(COL.road);
    else if (lines.some((l) => distToPolyline(x, z, l) < 1.0)) c.copy(COL.trail);
    else if (isOpen(x, z)) c.copy(h > 12 ? COL.rock : COL.open);
    else c.copy(COL.floor);
    c.offsetHSL(0, 0, Math.sin(x * 1.3) * Math.cos(z * 1.7) * 0.02 + Math.min(0.06, h * 0.003));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ground.receiveShadow = true; ground.name = 'ozark-ground';
  root.add(ground);
  // Creek water: one plane just below the valley floor; the terrain hides it everywhere but the bed.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * H, 2 * H), new THREE.MeshStandardMaterial({ color: 0x1a2a30, roughness: 0.2, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.name = 'ozark-creek';
  root.add(water);
  solid(-H, H, H, H + 1, -5, 30); solid(-H, -H - 1, H, -H, -5, 40); solid(-H - 1, -H, -H, H, -5, 40); solid(H, -H, H + 1, H, -5, 40);

  // ---- trees ----------------------------------------------------------------------------------------
  const trees = planTrees();
  const trunk = new THREE.CylinderGeometry(1, 1, 1, 6); trunk.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const mats = { bark: new THREE.MeshLambertMaterial({ color: 0x3a2e24, flatShading: true }),
    oak: new THREE.MeshLambertMaterial({ color: 0x3a4a26, flatShading: true }), pine: new THREE.MeshLambertMaterial({ color: 0x1f3324, flatShading: true }) };
  const M4 = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  const groups = { trunk: [], oak: [], pine: [] };
  for (const t of trees) {
    const y = heightAt(t.x, t.z) - 0.3;
    groups.trunk.push(M4(t.x, y, t.z, t.r, t.h * 0.8, t.r));
    if (t.kind === 'pine') groups.pine.push(M4(t.x, y + t.h * 0.35, t.z, 1.9, t.h * 0.7, 1.9));
    else groups.oak.push(M4(t.x, y + t.h * 0.72, t.z, 2.6, 2.0, 2.6));
    solid(t.x - t.r, t.z - t.r, t.x + t.r, t.z + t.r, y, y + t.h);
  }
  for (const [k, geom, m] of [['trunk', trunk, mats.bark], ['oak', blob, mats.oak], ['pine', cone, mats.pine]]) {
    const im = new THREE.InstancedMesh(geom, m, groups[k].length); im.name = `ozark-${k}`;
    im.castShadow = true; im.receiveShadow = true;
    groups[k].forEach((mm, i) => im.setMatrixAt(i, mm));
    root.add(im);
  }

  // ---- cliff bands ---------------------------------------------------------------------------------
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6a655c, flatShading: true });
  for (const b of planCliffs()) {
    const y = heightAt(b.x, b.z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h + 2, b.d), rockMat);
    m.position.set(b.x, y + b.h / 2 - 1, b.z); m.rotation.y = (b.x % 3) * 0.04; m.castShadow = m.receiveShadow = true;
    root.add(m);
    solid(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, y - 2, y + b.h);
  }

  // ---- camps, route signs, the carcass, the exit ------------------------------------------------------
  const post = (x, z, color, h = 1.5, boards = [0]) => {
    const y = heightAt(x, z);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
    p.position.set(x, y + h / 2, z); root.add(p);
    for (const [k, a] of boards.entries()) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.05), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }));
      s.position.set(x + Math.sin(a) * 0.3, y + h - 0.12 - k * 0.3, z + Math.cos(a) * 0.3); s.rotation.y = a + Math.PI / 2;
      root.add(s);
    }
  };
  for (const cp of CAMPS) {
    const y = heightAt(cp.x, cp.z);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 5), new THREE.MeshLambertMaterial({ color: cp.sheltered ? 0x5a4a34 : 0x7a6a4a }));
    pad.position.set(cp.x, y + 0.04, cp.z); pad.receiveShadow = true; pad.name = `camp-${cp.id}`;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 4, 10), rockMat);
    ring.rotation.x = Math.PI / 2; ring.position.set(cp.x + 1.4, y + 0.12, cp.z + 1.4);
    root.add(pad, ring);
    post(cp.x - 2.8, cp.z + 2.8, cp.sheltered ? 0x3a7a4a : 0xb08a3a);
  }
  // Junction sign: one board toward each route home.
  const toward = (r) => Math.atan2(r.pts[1].x - JUNCTION.x, r.pts[1].z - JUNCTION.z);
  post(JUNCTION.x + 1.5, JUNCTION.z, 0xc8b040, 1.8, [toward(ROUTES.bald), toward(ROUTES.gap)]);
  post(EXIT.x + 3, EXIT.z - 3, 0xc8b040, 2);
  for (const k of CARCASSES) {
    const y = heightAt(k.x, k.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 1.2), new THREE.MeshLambertMaterial({ color: 0x6a3a2a }));
    body.position.set(k.x, y + 0.18, k.z); body.rotation.y = 0.7; body.name = `carcass-${k.id}`;
    const stain = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10), new THREE.MeshLambertMaterial({ color: 0x3a1410 }));
    stain.rotation.x = -Math.PI / 2; stain.position.set(k.x, y + 0.03, k.z);
    root.add(body, stain);
  }

  const surfaceAt = (x, z) => (heightAt(x, z) < WATER_Y - 0.05 ? (heightAt(x, z) < WATER_Y - 0.9 ? 'deep' : 'shallow') : 'dry');
  const speedAt = (x, z) => ({ dry: 1, shallow: 0.6, deep: 0.4 })[surfaceAt(x, z)];
  const landmarks = Object.fromEntries(CAMPS.map((p) => [p.id, { x: p.x, z: p.z }]));
  Object.assign(landmarks, { trailhead: { ...TRAILHEAD }, junction: { ...JUNCTION }, den: { ...DEN }, bald: { x: -12, z: 45 }, gap: { x: 71, z: 40 } });

  return {
    colliders, bounds: H, heightAt, surfaceAt, speedAt, waterHeight: WATER_Y,
    noBigfoot: true,
    level: 7,
    playerStart: { x: TRAILHEAD.x + 3, z: TRAILHEAD.z - 4, yaw: 0 },
    exit: { x: EXIT.x - 4, z: EXIT.z + 5, name: EXIT.name },
    landmarks, camps: CAMPS, routes: ROUTES, carcasses: CARCASSES,
    // For the paper field map: trail lines and named places ('trailhead' is home).
    trails: [...Object.values(ROUTES).map((r) => r.pts), ...SIDE_TRAILS, ROAD],
    creek: Array.from({ length: 41 }, (_, i) => ({ x: -H + i * 5, z: creekZ(-H + i * 5) })),
    places: [{ id: 'trailhead', name: 'Trailhead', ...TRAILHEAD }, { id: 'junction', name: 'Junction', ...JUNCTION },
      ...CAMPS.map((cp) => ({ id: cp.id, name: cp.name, x: cp.x, z: cp.z })), { id: 'bald', name: 'The Bald', x: -12, z: 45 }, { id: 'gap', name: 'The Gap', x: 71, z: 40 }],
    spawns: { howler: { ...DEN } },
    keepClear: [], safeZones: [],
    // Ozark night: humid haze in the hollows, a moon over the ridges.
    environment: {
      background: 0x0c0e10, fog: { color: 0x101418, near: 15, far: 95 }, lightLevel: 0.05, airTemp: 14,
      night: {
        moonColor: 0xc8c8d8, moonIntensity: 0.8, moonDir: [-0.3, 0.5, -1],
        ambientSky: 0x2a3038, ambientGround: 0x0c0c0a, ambientIntensity: 0.7,
        fogColor: 0x12161a, fogDensity: 0.016, skyHorizon: 0x1c2228, skyZenith: 0x050608, moonGlow: 0x50586a,
      },
    },
  };
}

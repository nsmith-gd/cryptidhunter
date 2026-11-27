import * as THREE from 'three';
import {
  SIMCOE, shoreZ, heightAt, CAMPS, OBSERVATION, SURFACING, TRAILS, ROAD, PARKING, EXIT,
  planTrees, planRocks, distToPolyline, visibilityReport,
} from './simcoeLayout.js';

// Lake Simcoe shore — greybox (L0) for L03, the Igopogo (GDD §1.5, §12.2). Built from the pure
// layout in simcoeLayout.js: flat-coloured terrain (beach sand, grass, worn trails, gravel road),
// a dark lake plane, cylinder-and-cone trees, box rocks, and plain markers for the camp spots,
// observation points and road exit. The lake has an invisible wall where it gets too deep to wade.
// Open with ?map=simcoe.

const COL = {
  sand: new THREE.Color(0x8a7a5a), grass: new THREE.Color(0x3c4a30), forest: new THREE.Color(0x2c3424),
  trail: new THREE.Color(0x6a5640), road: new THREE.Color(0x6e6a64), bed: new THREE.Color(0x3a3a30), rock: new THREE.Color(0x77736c),
};

export function buildSimcoeMap(scene) {
  const H = SIMCOE.half;
  const root = new THREE.Group();
  root.name = 'simcoe';
  scene.add(root);
  const colliders = [];
  const solid = (x0, z0, x1, z1, y0, y1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));

  // ---- terrain: one displaced grid, vertex-coloured by what's underfoot --------------------
  const seg = 180;
  const geo = new THREE.PlaneGeometry(2 * H, 2 * H, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  const trails = [...Object.values(TRAILS)];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z), d = z - shoreZ(x);
    pos.setY(i, h);
    if (h < -0.05) c.copy(COL.bed);
    else if (distToPolyline(x, z, ROAD) < 2.2 || Math.hypot(x - PARKING.x, z - PARKING.z) < 7) c.copy(COL.road);
    else if (trails.some((t) => distToPolyline(x, z, t) < 1.1)) c.copy(COL.trail);
    else if (d < 9) c.copy(COL.sand);
    else if (h > 3.5 && Math.abs(x - 6) < 12) c.copy(COL.rock);
    else c.copy(d < 20 ? COL.grass : COL.forest);
    c.offsetHSL(0, 0, ((Math.sin(x * 1.7) * Math.cos(z * 1.3)) * 0.5) * 0.03);   // a little variation
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ground.receiveShadow = true; ground.name = 'simcoe-ground';
  root.add(ground);

  // ---- lake ---------------------------------------------------------------------------------
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * H + 200, 2 * H + 200),
    new THREE.MeshStandardMaterial({ color: 0x14283a, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, SIMCOE.waterY, -60); water.name = 'simcoe-lake';
  root.add(water);
  // Too deep to wade: a wall where the lake bed drops past the wade limit (you watch from shore).
  const off = SIMCOE.wadeLimit / 0.22;
  for (let x = -H; x < H; x += 3) {
    const z = Math.max(shoreZ(x), shoreZ(x + 3)) - off;
    solid(x, z - 1.5, x + 3, z, -5, 6);
  }
  // Boundary walls (the woods carry on beyond them as a tree line).
  solid(-H, H, H, H + 1, -5, 8); solid(-H - 1, -H, -H, H, -5, 8); solid(H, -H, H + 1, H, -5, 8);

  // ---- trees --------------------------------------------------------------------------------
  const trees = planTrees();
  const trunk = new THREE.CylinderGeometry(1, 1, 1, 6); trunk.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const mats = {
    bark: new THREE.MeshLambertMaterial({ color: 0x3a2e24, flatShading: true }), birchBark: new THREE.MeshLambertMaterial({ color: 0xb8b2a2, flatShading: true }),
    pine: new THREE.MeshLambertMaterial({ color: 0x1f3324, flatShading: true }), cedar: new THREE.MeshLambertMaterial({ color: 0x24402a, flatShading: true }),
    birch: new THREE.MeshLambertMaterial({ color: 0x4a5a2e, flatShading: true }),
  };
  const inst = (g, m, n) => { const im = new THREE.InstancedMesh(g, m, n); im.castShadow = true; im.receiveShadow = true; root.add(im); return im; };
  const groups = { trunk: [], birchTrunk: [], pine: [], cedar: [], birch: [] };
  const M4 = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  for (const t of trees) {
    const y = heightAt(t.x, t.z) - 0.2;
    (t.kind === 'birch' ? groups.birchTrunk : groups.trunk).push(M4(t.x, y, t.z, t.r, t.h * 0.8, t.r));
    if (t.kind === 'pine') groups.pine.push(M4(t.x, y + t.h * 0.3, t.z, 1.8, t.h * 0.75, 1.8));
    else if (t.kind === 'cedar') groups.cedar.push(M4(t.x, y, t.z, 1.8, t.h, 1.8));
    else groups.birch.push(M4(t.x, y + t.h * 0.75, t.z, 1.4, 1.8, 1.4));
    solid(t.x - t.r, t.z - t.r, t.x + t.r, t.z + t.r, y, y + t.h);
  }
  for (const [k, g, m] of [['trunk', trunk, mats.bark], ['birchTrunk', trunk, mats.birchBark], ['pine', cone, mats.pine], ['cedar', cone, mats.cedar], ['birch', blob, mats.birch]]) {
    if (!groups[k].length) continue;
    const im = inst(g, m, groups[k].length); im.name = `simcoe-${k}`;
    groups[k].forEach((mm, i) => im.setMatrixAt(i, mm));
  }
  // Tree line outside the boundary so the edge reads as woods.
  const edge = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 3, t = -H + ((i * 37) % 180);
    const [x, z] = side === 0 ? [t, H + 4 + (i % 5)] : side === 1 ? [-H - 4 - (i % 5), t] : [H + 4 + (i % 5), t];
    if (z < shoreZ(x) + 15) continue;
    edge.push(M4(x, heightAt(Math.max(-H, Math.min(H, x)), Math.max(-H, Math.min(H, z))) + 2, z, 2.2, 12, 2.2));
  }
  const em = inst(cone, mats.pine, edge.length); edge.forEach((mm, i) => em.setMatrixAt(i, mm));

  // ---- rocks ----------------------------------------------------------------------------------
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6e6a64, flatShading: true });
  for (const b of planRocks()) {
    const y = heightAt(b.x, b.z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h + 0.4, b.d), rockMat);
    m.position.set(b.x, y + (b.h - 0.4) / 2, b.z); m.castShadow = m.receiveShadow = true; m.name = `simcoe-${b.name}`;
    root.add(m);
    solid(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, y - 0.4, y + b.h);
  }

  // ---- markers: camp spots, observation points, road exit ---------------------------------------
  const post = (x, z, color, h = 1.4) => {
    const y = heightAt(x, z);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
    p.position.set(x, y + h / 2, z);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.05), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }));
    sign.position.set(x, y + h - 0.1, z);
    root.add(p, sign);
    return y;
  };
  for (const cp of CAMPS) {
    const y = heightAt(cp.x, cp.z);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 5), new THREE.MeshLambertMaterial({ color: cp.sheltered ? 0x5a4a34 : 0x7a6a4a }));
    pad.position.set(cp.x, y + 0.03, cp.z); pad.receiveShadow = true; pad.name = `camp-${cp.id}`;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 4, 10), rockMat);   // stone fire ring
    ring.rotation.x = Math.PI / 2; ring.position.set(cp.x + 1.4, y + 0.1, cp.z + 1.4);
    root.add(pad, ring);
    post(cp.x - 2.8, cp.z + 2.8, cp.sheltered ? 0x3a7a4a : 0xb08a3a);
  }
  for (const o of OBSERVATION) {
    const y = heightAt(o.x, o.z);
    for (let k = 0; k < 3; k++) {                       // a small cairn
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.7 - k * 0.2, 0.3, 0.6 - k * 0.15), rockMat);
      s.position.set(o.x + 1.6, y + 0.15 + k * 0.3, o.z + 0.6); s.rotation.y = k * 0.7;
      root.add(s);
    }
    post(o.x - 1.4, o.z + 1.2, 0x4a6a9a);
  }
  post(EXIT.x + 3, EXIT.z - 3, 0xc8b040, 2);
  // Faint rings on the water where it surfaces (greybox aid, hidden with ?nozones).
  if (!new URLSearchParams(globalThis.location?.search ?? '').has('nozones')) {
    for (const s of SURFACING) {
      const r = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.15, s.r, 40), new THREE.MeshBasicMaterial({ color: 0x5a7a8a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.position.set(s.x, SIMCOE.waterY + 0.02, s.z); r.name = `surfacing-${s.id}`;
      root.add(r);
    }
  }

  const surfaceAt = (x, z) => {
    const h = heightAt(x, z);
    if (h > SIMCOE.waterY + 0.05) return 'dry';
    return SIMCOE.waterY - h < SIMCOE.shallowDepth ? 'shallow' : 'deep';
  };
  const speedAt = (x, z) => ({ dry: 1, shallow: SIMCOE.shallowSpeed, deep: 0.35 })[surfaceAt(x, z)];
  const landmarks = Object.fromEntries([...CAMPS, ...OBSERVATION].map((p) => [p.id, { x: p.x, z: p.z }]));
  landmarks.parking = { x: PARKING.x, z: PARKING.z };

  return {
    colliders,
    bounds: H,
    heightAt,
    surfaceAt,
    speedAt,
    waterHeight: SIMCOE.waterY,
    noBigfoot: true,
    level: 3,
    playerStart: { x: PARKING.x - 3, z: PARKING.z - 4, yaw: 0.6 },
    exit: { x: EXIT.x + 2, z: EXIT.z + 6, name: EXIT.name },
    landmarks,
    camps: CAMPS, observation: OBSERVATION, surfacing: SURFACING,
    // For the paper field map (nav/fieldMap.js): trail lines and named places ('trailhead' is home).
    trails: [...Object.values(TRAILS), ROAD],
    places: [{ id: 'trailhead', name: 'Parking', x: PARKING.x, z: PARKING.z }, ...CAMPS.map((c) => ({ id: c.id, name: c.name, x: c.x, z: c.z })),
      ...OBSERVATION.map((o) => ({ id: o.id, name: o.name.replace(/^the /, 'The '), x: o.x, z: o.z }))],
    /** Which dry observation points see each surfacing zone (line of sight; for checks and debug). */
    get visibility() { return visibilityReport({ trees }); },
    spawns: {},
    keepClear: [],
    safeZones: [],
    // Lake night: a high moon over the water so the bay reads silver, a long view, light haze.
    environment: {
      background: 0x0b1420, fog: { color: 0x0e1824, near: 20, far: 130 }, lightLevel: 0.06, airTemp: 9,
      night: {
        moonColor: 0xc0d0e8, moonIntensity: 0.9, moonDir: [0.2, 0.45, -1],
        ambientSky: 0x2a3a50, ambientGround: 0x0a0c0e, ambientIntensity: 0.75,
        fogColor: 0x101a26, fogDensity: 0.012, skyHorizon: 0x1c2a3c, skyZenith: 0x04070c, moonGlow: 0x4a6080,
      },
    },
  };
}

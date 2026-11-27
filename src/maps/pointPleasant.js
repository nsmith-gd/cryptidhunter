import * as THREE from 'three';
import {
  PP, heightAt, JUNCTIONS, ROAD_LINES, LANDMARKS, PYLONS, RAIL, OVERLOOKS, EXIT, START, SIGNS, planIgloos, planTrees, distToRoads, distToSeg,
} from './pointPleasantLayout.js';

// Point Pleasant — greybox (L0) for L08, the Mothman (GDD §1.5, §12.2). A fictional reclaimed
// munitions works gone back to woods, built from pointPleasantLayout.js: gravel works roads (the
// stable paths) with a signpost at every junction, rows of grassed-over storage igloos, the Water
// Tower, the Stack and the Hopper standing over the trees, a pylon line and a rail spur (the
// Mothman's corridors), two bare overlooks, and the gated road exit, Route 62.
// Open with ?map=pointpleasant.

const COL = { floor: new THREE.Color(0x343a28), road: new THREE.Color(0x6e6a5e), rail: new THREE.Color(0x4a3a30), bare: new THREE.Color(0x5e5a48), yard: new THREE.Color(0x5a584c) };

export function buildPointPleasantMap(scene) {
  const H = PP.half;
  const root = new THREE.Group(); root.name = 'pointpleasant'; scene.add(root);
  const colliders = [];
  const solid = (x0, z0, x1, z1, y0, y1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

  // ---- terrain ----------------------------------------------------------------------------------
  const seg = 180, geo = new THREE.PlaneGeometry(2 * H, 2 * H, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  const railD = (x, z) => Math.min(...RAIL.slice(1).map((b, i) => distToSeg(x, z, RAIL[i], b)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    if (distToRoads(x, z) < 2.4 || distToSeg(x, z, JUNCTIONS.gate, EXIT) < 2.4) c.copy(COL.road);
    else if (railD(x, z) < 1.4) c.copy(COL.rail);
    else if (Object.values(JUNCTIONS).some((j) => Math.hypot(x - j.x, z - j.z) < 8)) c.copy(COL.yard);
    else if (OVERLOOKS.some((o) => Math.hypot(x - o.x, z - o.z) < 11)) c.copy(COL.bare);
    else c.copy(COL.floor);
    c.offsetHSL(0, 0, Math.sin(x * 1.1) * Math.cos(z * 1.3) * 0.02);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ground.receiveShadow = true; ground.name = 'pp-ground'; root.add(ground);
  solid(-H, -H - 1, H, -H, -5, 40); solid(-H - 1, -H, -H, H, -5, 40); solid(H, -H, H + 1, H, -5, 40);
  solid(-H, H, EXIT.x - 4, H + 1, -5, 40); solid(EXIT.x + 4, H, H, H + 1, -5, 40);

  // ---- trees ------------------------------------------------------------------------------------
  const trees = planTrees();
  const trunk = new THREE.CylinderGeometry(1, 1, 1, 6); trunk.translate(0, 0.5, 0);
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const M4 = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  const tr = [], cr = [];
  for (const t of trees) {
    const y = heightAt(t.x, t.z) - 0.2;
    tr.push(M4(t.x, y, t.z, t.r, t.h * 0.8, t.r)); cr.push(M4(t.x, y + t.h * 0.72, t.z, 2.3, t.h * 0.28, 2.3));
    solid(t.x - t.r, t.z - t.r, t.x + t.r, t.z + t.r, y, y + t.h);
  }
  for (const [list, geom, m] of [[tr, trunk, lam(0x3a3028)], [cr, blob, lam(0x3a4a2a)]]) {
    const im = new THREE.InstancedMesh(geom, m, list.length); im.castShadow = true; im.receiveShadow = true;
    list.forEach((mm, i) => im.setMatrixAt(i, mm)); root.add(im);
  }

  // ---- igloos, landmarks, pylons, rail ----------------------------------------------------------------
  const concrete = lam(0x7a766c), grassy = lam(0x4a5636), rust = lam(0x6a4030), steel = lam(0x55585c), brick = lam(0x6a3a2e);
  for (const b of planIgloos()) {
    const y = heightAt(b.x, b.z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.d, 10, 1, false, 0, Math.PI), grassy);
    m.rotation.set(Math.PI / 2, 0, Math.PI / 2); m.position.set(b.x, y, b.z); m.castShadow = m.receiveShadow = true; root.add(m);
    const face = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, b.h, 0.4), concrete); face.position.set(b.x, y + b.h / 2, b.z + b.d / 2 * Math.sign(b.z)); root.add(face);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 0.1), rust); door.position.set(b.x, y + 1, b.z + (b.d / 2 + 0.22) * Math.sign(b.z)); root.add(door);
    solid(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, y - 1, y + b.h);
  }
  const perches = [], add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = true; root.add(m); return m; };
  for (const l of LANDMARKS) {
    const y = heightAt(l.x, l.z);
    if (l.id === 'waterTower') {
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) add(new THREE.Mesh(new THREE.BoxGeometry(0.4, l.height - 8, 0.4), steel), l.x + dx, y + (l.height - 8) / 2, l.z + dz);
      add(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 6, 12), rust), l.x, y + l.height - 5, l.z);
      add(new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.4, 12), steel), l.x, y + l.height - 0.8, l.z);
      solid(l.x - 3.3, l.z - 3.3, l.x + 3.3, l.z + 3.3, y, y + l.height);
    } else if (l.id === 'stack') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, l.height, 10), brick), l.x, y + l.height / 2, l.z);
      solid(l.x - 2.6, l.z - 2.6, l.x + 2.6, l.z + 2.6, y, y + l.height);
    } else {
      add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, l.height - 6, 12), concrete), l.x, y + 6 + (l.height - 6) / 2, l.z);
      add(new THREE.Mesh(new THREE.ConeGeometry(3.5, 4, 12), concrete), l.x, y + 4, l.z).rotation.x = Math.PI;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), steel), l.x + dx, y + 3, l.z + dz);
      solid(l.x - 3.5, l.z - 3.5, l.x + 3.5, l.z + 3.5, y, y + l.height);
    }
    perches.push(new THREE.Vector3(l.x, y + l.perch, l.z));
  }
  for (const p of PYLONS) {
    const y = heightAt(p.x, p.z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.8, p.height, 4), steel), p.x, y + p.height / 2, p.z);
    add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 0.3), steel), p.x, y + p.height - 2, p.z);
    solid(p.x - 1.5, p.z - 1.5, p.x + 1.5, p.z + 1.5, y, y + p.height);
    perches.push(new THREE.Vector3(p.x + 3.5, y + p.height - 1.6, p.z));
  }
  const wire = new THREE.LineBasicMaterial({ color: 0x22252a });
  for (const s of [-3.5, 3.5]) root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(PYLONS.map((p) => new THREE.Vector3(p.x + s, heightAt(p.x, p.z) + p.height - 2.3, p.z))), wire));

  // ---- signposts, the gate, overlook cairns ------------------------------------------------------------
  const board = lam(0xc8b040), wood = lam(0x5a4632);
  for (const s of SIGNS) {
    const y = heightAt(s.x, s.z);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), wood), s.x, y + 1, s.z);
    s.boards.forEach((to, k) => {
      const t = JUNCTIONS[to], a = Math.atan2(t.x - s.x, t.z - s.z);
      const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.8), board), s.x + Math.sin(a) * 0.35, y + 1.8 - k * 0.24, s.z + Math.cos(a) * 0.35);
      b.rotation.y = a;
    });
  }
  const gy = heightAt(EXIT.gate.x, EXIT.gate.z);
  for (const sx of [-3.5, 3.5]) add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3), steel), EXIT.gate.x + sx, gy + 1, EXIT.gate.z + 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.12), lam(0xc0a030)), EXIT.gate.x + 2, gy + 1.1, EXIT.gate.z + 2).rotation.y = 0.9;   // swung open
  const exitSign = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.08), lam(0x2a6a3a)), EXIT.gate.x - 4.5, gy + 2.2, EXIT.gate.z + 2.5);
  exitSign.material.emissive = new THREE.Color(0x1a4a2a); exitSign.name = 'sign-route-62';
  add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), wood), EXIT.gate.x - 4.5, gy + 1.1, EXIT.gate.z + 2.5);
  for (const o of OVERLOOKS) {
    const y = heightAt(o.x, o.z);
    for (let k = 0; k < 3; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.8 - k * 0.2, 0.35, 0.7 - k * 0.15), concrete), o.x + 1.5, y + 0.17 + k * 0.35, o.z + 1);
  }

  const landmarks = { ...Object.fromEntries(Object.entries(JUNCTIONS).map(([k, v]) => [k, { ...v }])),
    ...Object.fromEntries(LANDMARKS.map((l) => [l.id, { x: l.x, z: l.z }])), ...Object.fromEntries(OVERLOOKS.map((o) => [o.id, { x: o.x, z: o.z }])) };
  return {
    colliders, bounds: H, heightAt,
    noBigfoot: true, mothman: true, level: 8,
    playerStart: { x: START.x, z: START.z, yaw: 0 },
    exit: { x: EXIT.x, z: EXIT.z, name: EXIT.name },
    landmarks, signs: SIGNS.map((s) => ({ post: { x: s.x, z: s.z } })),
    trails: [...ROAD_LINES, [JUNCTIONS.gate, EXIT]],
    places: [{ id: 'trailhead', name: 'Route 62 gate', ...EXIT.gate }, ...LANDMARKS.map((l) => ({ id: l.id, name: l.name.replace(/^the /, 'The '), x: l.x, z: l.z })),
      ...OVERLOOKS.map((o) => ({ id: o.id, name: o.name, x: o.x, z: o.z }))],
    // The Mothman perches on the tall things and travels the pylon line and the rail spur.
    spawns: { mothman: { x: LANDMARKS[0].x, z: LANDMARKS[0].z } },
    mothmanPerches: perches,
    // One continuous flight line: up the rail spur from the south, then east along the pylon line.
    mothmanCorridors: [[
      ...RAIL.map((p) => new THREE.Vector3(p.x, 14, p.z)),
      ...PYLONS.map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + p.height + 3, p.z)),
    ]],
    keepClear: [], safeZones: [],
    environment: {
      background: 0x0c0d10, fog: { color: 0x121418, near: 18, far: 110 }, lightLevel: 0.05, airTemp: 8,
      night: {
        moonColor: 0xc0c4d0, moonIntensity: 0.7, moonDir: [0.4, 0.45, -1],
        ambientSky: 0x2a2e36, ambientGround: 0x0c0c0a, ambientIntensity: 0.7,
        fogColor: 0x14161a, fogDensity: 0.012, skyHorizon: 0x22262e, skyZenith: 0x050608, moonGlow: 0x50566a,
      },
    },
  };
}

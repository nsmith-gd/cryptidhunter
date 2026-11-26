import * as THREE from 'three';
import { pixelTexture, pixelMaterial, waterTexture, metalTexture, furTexture } from '../art/pixelTex.js';
import { CELL, W, H, CEILING, PLACES, SIGNS, cellToWorld, worldToCell } from './tunnelLayout.js';

// Builds the L01 Cabbagetown tunnels (greybox+, L1 functional) from the authored grid:
// brick walls, a concrete floor and vault, flooded culvert water, the three landmarks, the warm
// alcove, the exit ladder shaft, signs, and the props you interact with. Walls, floor and ceiling
// are each one merged mesh (three draws). Every wall face is also a collider box.

const FLOOR = { 1: 0, 2: -0.3, 3: -0.6 };          // floor height per cell kind (water cells are lower)
const WATER_Y = -0.02;                              // flooded culvert surface

// ---- textures --------------------------------------------------------------------------------
function brickTexture() {
  return pixelTexture('l01-brick', 32, 32, (g, px, r, w, h) => {
    const mortar = '#3a3530', pal = ['#7a4030', '#874a36', '#6a3a2c', '#95563d', '#553226'];
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 4 : 0;
      for (let b = -1; b < 4; b++) {
        const x0 = b * 8 + off, y0 = row * 4, c = pal[Math.floor(r() * pal.length)];
        for (let y = 0; y < 3; y++) for (let x = 0; x < 7; x++) px(x0 + x, y0 + y, c);
        px(x0, y0, '#a8664a');                                         // lit top-left corner
        if (r() < 0.3) px(x0 + 1 + Math.floor(r() * 5), y0 + 1, pal[4]);   // chips
      }
    }
    // Damp: dark seepage running down from the top, white salt bloom at its edges.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * w), len = 8 + Math.floor(r() * 20);
      for (let y = 0; y < len; y++) { px(x, y, '#2b1a16'); if (r() < 0.5) px(x + 1, y, '#2b1a16'); if (r() < 0.12) px(x - 1, y, '#9a9488'); }
    }
  }, { seed: 102 });
}
function concreteTexture(name, seed, base) {
  return pixelTexture(name, 32, 32, (g, px, r, w, h) => {
    const pal = base;
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) px(Math.floor(r() * w), Math.floor(r() * h), pal[Math.floor(r() * 3)]);
    for (let i = 0; i < 3; i++) {                                     // cracks
      let x = Math.floor(r() * w), y = Math.floor(r() * h);
      for (let k = 0; k < 10; k++) { px(x, y, pal[3]); x += Math.round(r() * 2 - 1); y += 1; }
    }
    for (let i = 0; i < 2; i++) {                                     // wet patches (darker, a glint)
      const cx = Math.floor(r() * w), cy = Math.floor(r() * h);
      for (let y = -3; y <= 3; y++) for (let x = -5; x <= 5; x++) if (x * x / 25 + y * y / 9 < 1 && r() < 0.8) px(cx + x, cy + y, pal[3]);
      px(cx - 1, cy - 1, pal[4]);
    }
  }, { seed });
}
const floorTexture = () => concreteTexture('l01-floor', 7, ['#55524c', '#5f5c55', '#6a665e', '#34322d', '#9c988c']);
const vaultTexture = () => concreteTexture('l01-vault', 9, ['#403e3a', '#4a4743', '#55514c', '#2a2826', '#7a4c2c']);

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 16;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 96, 16);
  g.font = 'bold 12px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#d8d0b4';
  g.fillText(text, 48, 8.5);
  // Wear: knock pixels out of the stencil paint.
  const d = g.getImageData(0, 0, 96, 16);
  for (let i = 0; i < d.data.length; i += 4) if (d.data[i + 3] > 0 && Math.random() < 0.12) d.data[i + 3] = 0;
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function muralTexture() {
  return pixelTexture('l01-mural', 64, 32, (g, px, r, w, h) => {
    g.clearRect(0, 0, w, h);
    // A faded heron standing in reeds, painted decades ago (pale blue, white and ochre).
    const body = '#8fa7b3', light = '#d9d7c7', ochre = '#b58a3a', reed = '#5d7a52';
    for (let y = 8; y < 20; y++) for (let x = 24; x < 38; x++) if (((x - 31) / 7) ** 2 + ((y - 14) / 6) ** 2 < 1) px(x, y, body);
    for (let y = 2; y < 10; y++) { px(35 + Math.floor((y - 2) / 3), y, body); px(36 + Math.floor((y - 2) / 3), y, body); }  // neck
    for (let x = 37; x < 46; x++) px(x, 3, ochre);                                                                       // bill
    px(37, 2, light); px(38, 2, light);
    for (let y = 19; y < 28; y++) { px(29, y, ochre); px(33, y, ochre); }                                               // legs
    for (let i = 0; i < 14; i++) { const x = 8 + Math.floor(r() * 50); for (let y = 18 + Math.floor(r() * 6); y < 31; y++) px(x, y, reed); }
    for (let x = 4; x < 60; x++) if (r() < 0.6) px(x, 30, '#4f6f7a');                                                  // water line
    // Flaking: knock out patches.
    const d = g.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) if (Math.random() < 0.22) d.data[i + 3] = 0;
    g.putImageData(d, 0, 0);
  }, { seed: 5, alpha: true });
}

// ---- geometry helpers --------------------------------------------------------------------------
class Batch {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; }
  /** A quad from 4 corners (counter-clockwise seen from the front), with a normal and UVs. */
  quad(a, b, c, d, n, uvs) {
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      this.pos.push(...p); this.nrm.push(...n); this.uv.push(...t);
    }
  }
  mesh(material, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const m = new THREE.Mesh(g, material);
    m.name = name; m.receiveShadow = true;
    return m;
  }
}

/**
 * layout: tunnelLayout.layoutFor(rand). opts: { collapsed } (the entrance stair is rubble).
 * Returns the map interface the L01 page uses.
 */
export function buildTunnelMap(scene, layout, { collapsed = true } = {}) {
  const g = layout.grid, colliders = [], props = {}, root = new THREE.Group();
  root.name = 'l01-tunnels';
  scene.add(root);
  const kind = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : g[y * W + x]);
  const x0 = (cx) => (cx - W / 2) * CELL, z0 = (cy) => (cy - H / 2) * CELL;
  const floorOf = (cx, cy) => FLOOR[kind(cx, cy)] ?? 0;
  const special = new Set([`${PLACES.grate.x},${PLACES.grate.y}`, `${PLACES.exit.x},${PLACES.exit.y}`, `${PLACES.entrance.x},${PLACES.entrance.y}`]);

  const walls = new Batch(), floors = new Batch(), vault = new Batch();
  const T = 2;                                                  // texture tile size (m)
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const k = kind(cx, cy);
    if (!k) continue;
    const ax = x0(cx), az = z0(cy), bx = ax + CELL, bz = az + CELL, fy = floorOf(cx, cy);
    floors.quad([ax, fy, bz], [bx, fy, bz], [bx, fy, az], [ax, fy, az], [0, 1, 0], [[ax / T, bz / T], [bx / T, bz / T], [bx / T, az / T], [ax / T, az / T]]);
    if (!special.has(`${cx},${cy}`)) {
      vault.quad([ax, CEILING, az], [bx, CEILING, az], [bx, CEILING, bz], [ax, CEILING, bz], [0, -1, 0], [[ax / T, az / T], [bx / T, az / T], [bx / T, bz / T], [ax / T, bz / T]]);
    }
    // Walls toward rock; steps toward a lower neighbour's floor.
    const sides = [
      { dx: 0, dy: -1, a: [bx, az], b: [ax, az], n: [0, 0, 1] },    // north wall, faces +z (south)
      { dx: 0, dy: 1, a: [ax, bz], b: [bx, bz], n: [0, 0, -1] },
      { dx: -1, dy: 0, a: [ax, az], b: [ax, bz], n: [1, 0, 0] },
      { dx: 1, dy: 0, a: [bx, bz], b: [bx, az], n: [-1, 0, 0] },
    ];
    for (const s of sides) {
      const nk = kind(cx + s.dx, cy + s.dy);
      const ua = (s.n[0] ? s.a[1] : s.a[0]) / T, ub = (s.n[0] ? s.b[1] : s.b[0]) / T;
      if (!nk) {
        const lo = fy;
        walls.quad([s.a[0], lo, s.a[1]], [s.b[0], lo, s.b[1]], [s.b[0], CEILING, s.b[1]], [s.a[0], CEILING, s.a[1]], s.n,
          [[ua, lo / T], [ub, lo / T], [ub, CEILING / T], [ua, CEILING / T]]);
        // Collider: a slab just behind the wall face.
        const t = 0.5, box = new THREE.Box3();
        if (s.n[2]) box.set(new THREE.Vector3(ax, -2, s.a[1] - (s.n[2] > 0 ? t : 0)), new THREE.Vector3(bx, CEILING + 2, s.a[1] + (s.n[2] > 0 ? 0 : t)));
        else box.set(new THREE.Vector3(s.a[0] - (s.n[0] > 0 ? t : 0), -2, az), new THREE.Vector3(s.a[0] + (s.n[0] > 0 ? 0 : t), CEILING + 2, bz));
        colliders.push(box);
      } else {
        const nf = floorOf(cx + s.dx, cy + s.dy);
        if (nf < fy) walls.quad([s.a[0], nf, s.a[1]], [s.b[0], nf, s.b[1]], [s.b[0], fy, s.b[1]], [s.a[0], fy, s.a[1]], s.n.map((v) => -v),
          [[ua, nf / T], [ub, nf / T], [ub, fy / T], [ua, fy / T]]);
      }
    }
  }
  const brick = pixelMaterial(brickTexture()), floorMat = pixelMaterial(floorTexture()), vaultMat = pixelMaterial(vaultTexture());
  brick.side = THREE.DoubleSide;   // step faces are seen from both sides
  root.add(walls.mesh(brick, 'l01-walls'), floors.mesh(floorMat, 'l01-floor'), vault.mesh(vaultMat, 'l01-vault'));

  // ---- flooded culvert water ----
  const wShallow = new Batch(), wDeep = new Batch();
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const k = kind(cx, cy);
    if (k < 2) continue;
    const ax = x0(cx), az = z0(cy), bx = ax + CELL, bz = az + CELL, b = k === 3 ? wDeep : wShallow;
    b.quad([ax, WATER_Y, bz], [bx, WATER_Y, bz], [bx, WATER_Y, az], [ax, WATER_Y, az], [0, 1, 0], [[ax / 3, bz / 3], [bx / 3, bz / 3], [bx / 3, az / 3], [ax / 3, az / 3]]);
  }
  const waterMat = (deep) => new THREE.MeshStandardMaterial({ map: waterTexture(deep), roughness: 0.12, metalness: 0.25, transparent: true, opacity: deep ? 0.92 : 0.8, depthWrite: false });
  root.add(wShallow.mesh(waterMat(false), 'l01-water'), wDeep.mesh(waterMat(true), 'l01-water-deep'));

  // ---- props helpers ----
  const at = (c, y = 0) => { const p = cellToWorld(c); return new THREE.Vector3(p.x, y, p.z); };
  const wallPoint = (c, face, y, inset = 0.03) => {
    const p = at(c, y), h = CELL / 2 - inset;
    const d = { N: [0, -h], S: [0, h], W: [-h, 0], E: [h, 0] }[face];
    p.x += d[0]; p.z += d[1];
    return { p, rotY: { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 }[face] };
  };
  const rockSide = (c, prefer) => {
    const off = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
    if (!kind(c.x + off[prefer][0], c.y + off[prefer][1])) return prefer;
    return ['N', 'S', 'W', 'E'].find((f) => !kind(c.x + off[f][0], c.y + off[f][1])) ?? prefer;
  };
  const rust = pixelMaterial(metalTexture(), { color: 0x8a5a3a, roughness: 0.8 });

  // Signs (old maintenance stencils).
  for (const s of SIGNS) {
    const face = rockSide(s, s.face), { p, rotY } = wallPoint(s, face, 2.1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(s.text), transparent: true, roughness: 1 }));
    m.position.copy(p); m.rotation.y = rotY; m.name = `sign:${s.text}`;
    root.add(m);
  }

  // Landmark 1: the painted junction (a faded heron mural on the wall you face as you arrive).
  {
    const c = { x: 33, y: 10 }, { p, rotY } = wallPoint(c, rockSide(c, 'S'), 1.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: muralTexture(), transparent: true, alphaTest: 0.5, roughness: 1 }));
    m.position.copy(p); m.position.x += 2; m.rotation.y = rotY; m.name = 'landmark:mural';
    root.add(m);
  }
  // Landmark 2: the pump room (a huge rusted pump wheel on the west wall, the pump body in a corner).
  {
    const c = PLACES.pumpRoom, { p } = wallPoint({ x: c.x - 1, y: c.y }, 'W', 1.6, 0.35);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 6, 14), rust);
    wheel.position.copy(p); wheel.rotation.y = Math.PI / 2; wheel.name = 'landmark:pump-wheel';
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 0.08), rust);
      spoke.rotation.z = i * Math.PI / 4; wheel.add(spoke);
    }
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 2.4, 10), rust);
    body.position.copy(at({ x: c.x + 1, y: c.y + 1 }, 1.2)); body.castShadow = true; body.name = 'landmark:pump';
    root.add(wheel, body);
    colliders.push(new THREE.Box3().setFromObject(body));
  }
  // Landmark 3: the grate (a shaft up to an iron street grate; amber streetlight falls through it).
  {
    const c = PLACES.grate, p = at(c), shaftH = 9;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(CELL, shaftH, CELL), new THREE.MeshStandardMaterial({ map: brickTexture(), side: THREE.BackSide, roughness: 1 }));
    shaft.position.set(p.x, CEILING + shaftH / 2, p.z); shaft.name = 'landmark:grate-shaft';
    const grate = new THREE.Group(); grate.name = 'landmark:grate';
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 3.6), rust); bar.position.set(i * 0.4, 0, 0); grate.add(bar);
    }
    grate.position.set(p.x, CEILING + shaftH - 0.2, p.z);
    const lamp = new THREE.SpotLight(0xffb066, 9, 22, 0.42, 0.6, 1.2);
    lamp.position.set(p.x + 0.5, CEILING + shaftH + 1, p.z); lamp.target.position.set(p.x - 0.3, 0, p.z + 0.2);
    lamp.castShadow = true; lamp.shadow.mapSize.set(256, 256);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.5, CEILING + shaftH, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.set(p.x, (CEILING + shaftH) / 2, p.z); beam.name = 'landmark:grate-beam';
    root.add(shaft, grate, lamp, lamp.target, beam);
  }

  // The warm alcove: an old steam main along the walls still gives off heat (and a dull glow).
  const heat = [];
  {
    const c = PLACES.alcove, p = at(c);
    // Two lagged steam mains run along the alcove's back (north) wall, at knee and chest height.
    for (const [y, r] of [[0.55, 0.3], [1.35, 0.22]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, CELL * 3, 10), rust);
      pipe.rotation.z = Math.PI / 2; pipe.position.set(p.x, y, p.z - CELL * 1.5 + 0.45); pipe.name = 'alcove:steam-main';
      root.add(pipe);
    }
    const glow = new THREE.PointLight(0xff7a2e, 7, 11, 1.4);
    glow.position.set(p.x, 1.2, p.z); glow.name = 'alcove:glow';
    root.add(glow);
    props.alcoveGlow = glow;
    heat.push({ x: p.x, z: p.z, r: CELL * 1.6, name: 'the warm steam main' });
  }

  // The exit: a ladder up a maintenance shaft to a street hatch (cold blue light from above).
  {
    const c = PLACES.exit, p = at(c), shaftH = 8, face = 'S';
    const { p: wp, rotY } = wallPoint(c, face, 0, 0.25);
    const ladder = new THREE.Group(); ladder.name = 'exit:ladder';
    for (const sx of [-0.35, 0.35]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, CEILING + shaftH, 0.06), rust); rail.position.set(sx, (CEILING + shaftH) / 2, 0); ladder.add(rail); }
    for (let y = 0.3; y < CEILING + shaftH; y += 0.35) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.04), rust); rung.position.set(0, y, 0); ladder.add(rung); }
    ladder.position.copy(wp); ladder.rotation.y = rotY;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(CELL, shaftH, CELL), new THREE.MeshStandardMaterial({ map: brickTexture(), side: THREE.BackSide, roughness: 1 }));
    shaft.position.set(p.x, CEILING + shaftH / 2, p.z);
    const sky = new THREE.SpotLight(0x9fb8ff, 8, 18, 0.5, 0.7, 1.3);
    sky.position.set(p.x, CEILING + shaftH, p.z); sky.target.position.set(p.x, 0, p.z - 1);
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ color: 0x6f86b8 }));
    hatch.rotation.x = Math.PI / 2; hatch.position.set(p.x, CEILING + shaftH - 0.01, p.z + 1);
    root.add(ladder, shaft, sky, sky.target, hatch);
    props.exit = { position: at(c, 0), name: 'the maintenance ladder' };
  }

  // The entrance stair (north), with the rubble of the collapse when it has fallen in.
  {
    const c = PLACES.entrance, p = at(c);
    const stair = new THREE.Group(); stair.name = 'entrance:stair';
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.25, 0.4), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 }));
      s.position.set(p.x, 0.12 + i * 0.25, p.z + CELL / 2 - 0.2 - i * 0.4); stair.add(s);
    }
    const daylight = new THREE.PointLight(0x9fb0d0, collapsed ? 0 : 3, 9, 1.5);
    daylight.position.set(p.x, CEILING - 0.3, p.z - 1);
    root.add(stair, daylight);
    props.entrance = { position: at(c, 0), daylight, stair };
    const rubble = new THREE.Group(); rubble.name = 'entrance:rubble';
    const rock = new THREE.MeshStandardMaterial({ map: vaultTexture(), color: 0x8c8378, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + ((i * 37) % 10) / 14, 0), rock);
      r.position.set(p.x - 1.6 + ((i * 53) % 32) / 10, 0.3 + ((i * 29) % 25) / 10, p.z + 1.2 - ((i * 17) % 20) / 10);
      r.rotation.set(i, i * 2, i * 3); r.castShadow = true;
      rubble.add(r);
    }
    rubble.visible = collapsed;
    root.add(rubble);
    props.rubble = rubble;
    props.rubbleCollider = new THREE.Box3(new THREE.Vector3(p.x - CELL / 2, -1, p.z - CELL / 2), new THREE.Vector3(p.x + CELL / 2, CEILING + 1, p.z + CELL / 2 + 0.6));
    if (collapsed) colliders.push(props.rubbleCollider);
  }

  // Your packed lunch (dropped in the scramble) and the optional trace (fur caught on a drain grate).
  {
    const p = at(layout.lunch);
    const bag = new THREE.Group(); bag.name = 'pickup:lunch';
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.2), new THREE.MeshStandardMaterial({ color: 0xa08560, roughness: 1 }));
    paper.position.y = 0.18; paper.rotation.z = 0.15; bag.add(paper);
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.18), new THREE.MeshStandardMaterial({ color: 0x8c7250, roughness: 1 })); fold.position.y = 0.38; bag.add(fold);
    bag.position.set(p.x + 0.6, 0, p.z - 0.4); bag.rotation.y = 0.7;
    root.add(bag);
    props.lunch = bag;
  }
  {
    const c = layout.trace, face = rockSide(c, 'S'), { p, rotY } = wallPoint(c, face, 0.35, 0.12);
    const grate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.06), rust); grate.position.copy(p); grate.rotation.y = rotY;
    const fur = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshStandardMaterial({ map: furTexture(0), color: 0x4a3a30, roughness: 1, flatShading: true }));
    fur.scale.set(1.4, 0.6, 0.5); fur.position.copy(p); fur.position.y += 0.28; fur.rotation.y = rotY; fur.name = 'pickup:fur';
    root.add(grate, fur);
    props.fur = fur;
  }

  // ---- queries the systems read ----
  const cellAt = (x, z) => worldToCell(x, z);
  const surfaceAt = (x, z) => { const c = cellAt(x, z), k = kind(c.x, c.y); return k === 3 ? 'deep' : k === 2 ? 'shallow' : 'dry'; };
  const heightAt = (x, z) => { const c = cellAt(x, z); return floorOf(c.x, c.y); };
  // Pace: ballast and puddles underfoot in the dark (careful walking), wading slower still.
  const speedAt = (x, z) => ({ dry: 0.62, shallow: 0.45, deep: 0.32 })[surfaceAt(x, z)];

  return {
    root, colliders, props, heat, surfaceAt, heightAt, speedAt, cellAt,
    playerStart: { ...at(PLACES.start), yaw: Math.PI },       // facing south, down the tunnel
    environment: { background: 0x020203, fog: { color: 0x020203, near: 3, far: 26 }, airTemp: 8 },
    /** Make the entrance collapse now (the first-attempt event). */
    collapse() { props.rubble.visible = true; props.entrance.daylight.intensity = 0; if (!colliders.includes(props.rubbleCollider)) colliders.push(props.rubbleCollider); },
  };
}

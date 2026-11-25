import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  rng, pixelMaterial, plankTexture, boardWallTexture, tinRoofTexture, barkTexture, mossTexture,
  foliageTexture, mudTexture, waterTexture, reedTexture, lilyTexture,
} from '../art/pixelTex.js';
import { snapTextureToPalette } from '../art/palette.js';
import { cypressSprayCard, longMossCard, lilyFlowerCard, buildFogBanks } from '../art/swampArt.js';
import { ForestKit } from '../art/forestKit.js';

// Blackwater Swamp — greybox layout (L0) dressed with textured low-poly pieces.
// Layout (north = -z): spawn dock in the south, a boardwalk spine running north to a central
// mud island, branches west to the ranger shack and east to a fishing platform, then the old
// bridge (the landmark) arching over the deep channel to the north platform, Mothman's haunt.
// Everything off the boardwalks is water: shallow water slows you, the deep channel slows you
// a lot more. Boardwalks/islands are low solid boxes the player steps onto (top at DECK).
//
// Art approach: every surface carries a small hand-painted-style pixel texture (planks with
// nails and knots, fissured cypress bark, peat mud, rippled murky water, reed and moss cards),
// on simple low-poly shapes, then the game's low-resolution render pass on top.
// Collision is separate from the visuals: invisible AABBs, identical to the greybox layout.

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

export function buildSwampMap(scene) {
  const H = SWAMP.half, D = SWAMP.deck, W = SWAMP.water;
  const colliders = [];
  const decks = [];         // walkable dry tops (AABBs), for the connectivity check
  const r = rng(7);
  const ra = rng(4040);     // art #40 dressing: separate stream so the layout above stays put
  const root = new THREE.Group();
  root.name = 'swamp';
  scene.add(root);

  // ---- Materials (shared) ------------------------------------------------------------------
  const M = {
    planks: [0, 1, 2].map((v) => pixelMaterial(plankTexture(v))),
    beam: pixelMaterial(plankTexture(2), { color: 0x9a8f86 }),
    wall: pixelMaterial(boardWallTexture()),
    roof: pixelMaterial(tinRoofTexture(), { roughness: 0.6, metalness: 0.3 }),
    bark: pixelMaterial(barkTexture(0)),
    deadBark: pixelMaterial(barkTexture(1)),
    moss: pixelMaterial(mossTexture(), { side: THREE.DoubleSide }),
    foliage: pixelMaterial(foliageTexture(), { flatShading: true }),
    mud: pixelMaterial(mudTexture()),
    reeds: [0, 1].map((v) => pixelMaterial(reedTexture(v), { side: THREE.DoubleSide })),
    lily: pixelMaterial(lilyTexture(), { side: THREE.DoubleSide }),
    // Art #40: matte (Lambert) foliage cards, like the forest kit.
    spray: [0, 1].map((v) => new THREE.MeshLambertMaterial({ map: cypressSprayCard(v), alphaTest: 0.5, side: THREE.DoubleSide })),
    longMoss: new THREE.MeshLambertMaterial({ map: longMossCard(), alphaTest: 0.5, side: THREE.DoubleSide }),
    lilyFlower: new THREE.MeshLambertMaterial({ map: lilyFlowerCard(), alphaTest: 0.5, side: THREE.DoubleSide }),
  };
  // Tile a box's texture per metre so pixels stay the same size on every face.
  const boxUV = (geo, w, h, d, ppm) => {
    const uv = geo.attributes.uv;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 verts each.
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] * ppm, uv.getY(i) * dims[f][1] * ppm);
    }
    return geo;
  };
  const tiledBox = (w, h, d, ppm = 0.5) => boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, ppm);
  const add = (geo, mat, x, y, z, { ry = 0, rx = 0, rz = 0, shadow = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow; m.receiveShadow = true;
    if (name) m.name = name;
    root.add(m);
    return m;
  };

  // ---- Collision (invisible) -----------------------------------------------------------------
  const solid = (x0, z0, x1, z1, y0, y1, { deck = false } = {}) => {
    const b = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    colliders.push(b);
    if (deck) decks.push(b);
    return b;
  };

  // ---- Instanced batches ---------------------------------------------------------------------
  // Each batch collects matrices and becomes one InstancedMesh at the end.
  const batches = new Map();
  const batch = (key, geo, mat, { shadow = true } = {}) => {
    if (!batches.has(key)) batches.set(key, { geo, mat, shadow, mats: [], cols: [] });
    return batches.get(key);
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const put = (b, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1, tint = null) => {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    b.mats.push(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).clone());
    b.cols.push(tint ?? new THREE.Color(1, 1, 1));
  };

  // Plank: 1 m long (x) x 0.06 thick x 0.26 wide; scaled per walkway. Texture 32x8 → 1 m x 0.25 m.
  const plankGeo = new THREE.BoxGeometry(1, 0.06, 0.26);
  const plankBatches = M.planks.map((mat, i) => batch(`plank${i}`, plankGeo, mat));
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 6);
  postGeo.translate(0, 0.5, 0);
  boxUV(postGeo, 1, 1, 1, 1);
  const postBatch = batch('post', postGeo, M.deadBark);
  const beamGeo = tiledBox(1, 0.12, 0.14, 1);
  const beamBatch = batch('beam', beamGeo, M.beam);

  // Deck of planks laid across a walkway [x0,z0]-[x1,z1] with its top at `top`.
  const plankDeck = (x0, z0, x1, z1, top, { posts = true, wear = 0.06 } = {}) => {
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;           // walkway length
    const span = alongX ? z1 - z0 : x1 - x0;          // plank length (across)
    const pitch = 0.3;
    for (let t = pitch / 2; t < len; t += pitch) {
      const broken = r() < wear * 0.3, sag = r() < wear ? -0.03 - r() * 0.03 : 0;
      if (broken && t > 1 && t < len - 1) continue;    // a missing plank: gap (still walkable)
      const b = plankBatches[Math.floor(r() * 3)];
      const cx = alongX ? x0 + t : (x0 + x1) / 2 + (r() - 0.5) * 0.06;
      const cz = alongX ? (z0 + z1) / 2 + (r() - 0.5) * 0.06 : z0 + t;
      const plankLen = span + 0.06 + r() * 0.12;
      const shade = 0.82 + r() * 0.3;
      put(b, cx, top - 0.03 + sag + (r() - 0.5) * 0.012, cz, (alongX ? Math.PI / 2 : 0) + (r() - 0.5) * 0.04,
        (r() - 0.5) * 0.03, sag ? 0.04 : 0, plankLen, 1, 1, new THREE.Color(shade, shade, shade * 0.97));
    }
    // Two stringers underneath, along the walkway.
    for (const side of [0.25, 0.75]) {
      const cx = alongX ? (x0 + x1) / 2 : x0 + (x1 - x0) * side;
      const cz = alongX ? z0 + (z1 - z0) * side : (z0 + z1) / 2;
      put(beamBatch, cx, top - 0.12, cz, alongX ? 0 : Math.PI / 2, 0, 0, len, 1, 1);
    }
    if (!posts) return;
    for (let t = 0; t <= len + 0.01; t += 2.4) for (const side of [0, 1]) {
      const px = alongX ? x0 + t : side ? x1 + 0.05 : x0 - 0.05;
      const pz = alongX ? (side ? z1 + 0.05 : z0 - 0.05) : z0 + t;
      const h = top + 0.15 + r() * 0.35 + (r() < 0.1 ? 0.6 : 0);
      put(postBatch, px, -0.2, pz, r() * 6, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08, 1, h + 0.2, 1);
    }
  };
  const walk = (x0, z0, x1, z1, name, opts) => {
    solid(x0, z0, x1, z1, 0, D, { deck: true });
    plankDeck(x0, z0, x1, z1, D, opts);
    if (name) { const o = new THREE.Object3D(); o.name = name; o.position.set((x0 + x1) / 2, D, (z0 + z1) / 2); root.add(o); }
  };

  // ---- Water and bed -------------------------------------------------------------------------
  const waterTex = waterTexture(false), deepTex = waterTexture(true);
  const waterMat = pixelMaterial(waterTex, { repeat: [H * 2 / 4, H * 2 / 4], roughness: 0.55, metalness: 0.15, color: 0xd8e4d8 });
  const water = add(new THREE.PlaneGeometry(H * 2, H * 2), waterMat, 0, W, 0, { rx: -Math.PI / 2, shadow: false, name: 'water-shallow' });
  water.receiveShadow = true;
  const deepMats = [];
  for (const [x0, z0, x1, z1] of DEEP) {
    const mat = pixelMaterial(deepTex, { repeat: [(x1 - x0) / 4, (z1 - z0) / 4], roughness: 0.45, metalness: 0.2 });
    deepMats.push(mat);
    add(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat, (x0 + x1) / 2, W + 0.004, (z0 + z1) / 2,
      { rx: -Math.PI / 2, shadow: false, name: 'water-deep' });
  }
  // Slow drift of the ripples (pixel-snapped so texels never smear).
  water.onBeforeRender = () => {
    const t = performance.now() / 1000;
    const snap = (v, n) => Math.floor(v * n) / n;
    waterMat.map.offset.set(snap(t * 0.004, 64), snap(t * 0.0025, 64));
    for (const m of deepMats) m.map.offset.set(snap(-t * 0.002, 64), snap(t * 0.0015, 64));
  };

  // ---- Perimeter: invisible walls behind a dense wall of trees -------------------------------
  solid(-H, -H - 1, H, -H, 0, 6); solid(-H, H, H, H + 1, 0, 6);
  solid(-H - 1, -H, -H, H, 0, 6); solid(H, -H, H + 1, H, 0, 6);

  // ---- Boardwalk network ---------------------------------------------------------------------
  walk(-3, 38, 3, 45, 'spawn-dock');
  walk(-1, 20, 1, 38, 'south-spine');
  walk(-4, 14, 4, 20, 'junction');
  walk(-24, 16, -4, 18, 'west-walk');
  walk(-33, 9, -24, 23, 'shack-platform');
  walk(4, 16, 20, 18, 'east-walk');
  walk(18, -2, 20, 16, 'east-north-walk');
  walk(14, -9, 24, -2, 'fishing-platform');
  walk(-1, 2, 1, 14, 'north-spine');
  walk(-22, -4, -7, -2, 'broken-walk', { wear: 0.25 });
  walk(-34, -4, -27, -2, 'broken-walk-far', { wear: 0.25 });
  // The collapsed span between them: a few planks slumped into the water.
  for (let i = 0; i < 9; i++) {
    put(plankBatches[i % 3], -26.5 + i * 0.4, W - 0.05 + r() * 0.06, -3 + (r() - 0.5) * 0.6, Math.PI / 2 + (r() - 0.5) * 0.5, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, 2.1);
  }

  // Mud islands: a textured slab with lumpy low-poly edges so they don't read as boxes.
  const lumpGeo = new THREE.DodecahedronGeometry(1, 0);
  const lumpBatch = batch('lump', lumpGeo, M.mud);
  const islands = [];
  const island = (x0, z0, x1, z1) => {
    islands.push([x0, z0, x1, z1]);
    solid(x0, z0, x1, z1, 0, D, { deck: true });
    const w = x1 - x0, d = z1 - z0;
    add(tiledBox(w, D, d, 0.5), M.mud, (x0 + x1) / 2, D / 2, (z0 + z1) / 2);
    const per = 2 * (w + d);
    for (let s = 0; s < per; s += 0.9) {
      let x, z;
      if (s < w) { x = x0 + s; z = z0; } else if (s < w + d) { x = x1; z = z0 + s - w; }
      else if (s < 2 * w + d) { x = x1 - (s - w - d); z = z1; } else { x = x0; z = z1 - (s - 2 * w - d); }
      const sc = 0.5 + r() * 0.5;
      put(lumpBatch, x + (r() - 0.5) * 0.5, D - 0.22, z + (r() - 0.5) * 0.5, r() * 6, r(), r(), sc * 1.3, 0.3, sc * 1.3);
    }
  };
  island(-7, -10, 7, 2);           // central mud island the bridge lifts off from
  island(-16, 28, -10, 33);
  island(10, 26, 16, 31);
  island(-40, -36, -30, -30);
  island(28, -40, 38, -32);

  // ---- Ranger shack ------------------------------------------------------------------------
  const sx0 = -31, sx1 = -25, sz0 = 12, sz1 = 18, sh = D + 2.6;
  const wall = (x0, z0, x1, z1, y0, y1) => {
    solid(x0, z0, x1, z1, y0, y1);
    add(tiledBox(x1 - x0, y1 - y0, z1 - z0, 1), M.wall, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  wall(sx0, sz0, sx1, sz0 + 0.2, D, sh);
  wall(sx0, sz1 - 0.2, sx1, sz1, D, sh);
  wall(sx0, sz0, sx0 + 0.2, sz1, D, sh);
  wall(sx1 - 0.2, sz0, sx1, 14, D, sh);
  wall(sx1 - 0.2, 16, sx1, sz1, D, sh);
  wall(sx1 - 0.2, 14, sx1, 16, D + 2.1, sh);
  // Pitched tin roof (two tilted sheets) with gable boards.
  const roofW = (sx1 - sx0) / 2 + 0.6, roofTilt = 0.42;
  for (const s of [-1, 1]) {
    add(tiledBox(roofW / Math.cos(roofTilt), 0.06, sz1 - sz0 + 0.9, 1), M.roof,
      (sx0 + sx1) / 2 + s * roofW / 2, sh + Math.tan(roofTilt) * roofW / 2, (sz0 + sz1) / 2, { rz: -s * roofTilt, name: 'shack-roof' });
  }
  for (const z of [sz0 + 0.1, sz1 - 0.1]) {
    const tri = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, Math.tan(roofTilt) * 3)]);
    const g = new THREE.ShapeGeometry(tri);
    g.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 1; });
    add(g, pixelMaterial(boardWallTexture(), { side: THREE.DoubleSide }), (sx0 + sx1) / 2, sh, z);
  }
  // Lit window on the north wall and a lantern inside: a warm practical light in the cold swamp.
  const glass = new THREE.MeshBasicMaterial({ color: 0xffb35c });
  add(new THREE.PlaneGeometry(0.7, 0.5), glass, -28, D + 1.5, sz0 - 0.01, { ry: Math.PI, shadow: false });
  add(tiledBox(0.9, 0.08, 0.08, 1), M.beam, -28, D + 1.2, sz0 - 0.05); add(tiledBox(0.9, 0.08, 0.08, 1), M.beam, -28, D + 1.8, sz0 - 0.05);
  const shackLamp = new THREE.PointLight(0xff9a48, 5, 9, 1.8);
  shackLamp.position.set(-28, D + 1.9, 15);
  root.add(shackLamp);
  // Porch clutter: barrel, crab traps.
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), M.wall, -24.6, D + 0.4, 19.5);
  add(tiledBox(0.6, 0.4, 0.5, 1), M.beam, -24.7, D + 0.2, 21);

  // ---- Fishing platform ----------------------------------------------------------------------
  const crate = (x, z, s, ry) => add(tiledBox(s, s, s, 1), M.wall, x, D + s / 2, z, { ry });
  crate(20.6, -7.4, 1.1, 0.1); crate(21.9, -7.5, 0.9, -0.2); crate(21.2, -7.4, 0.7, 0.4).position.y += 1.1;
  solid(20, -8, 21.2, -6.8, D, D + 0.8); solid(21.4, -8, 22.4, -7, D, D + 0.6);
  // Upturned skiff in the shallows: a lathe hull, keel up.
  const hullPts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; hullPts.push(new THREE.Vector2(0.05 + Math.sin(t * Math.PI) * 0.7, (t - 0.5) * 5)); }
  const hull = new THREE.LatheGeometry(hullPts, 7, 0, Math.PI);
  add(hull, pixelMaterial(plankTexture(1), { side: THREE.DoubleSide, repeat: [3, 4] }), 26.7, 0.2, -2.5, { rx: Math.PI / 2, rz: Math.PI / 2 + 0.15, name: 'skiff' });
  solid(26, -5, 27.4, 0, 0, 0.55);
  // Fishing rod rack.
  for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.015, 0.02, 2.2, 4), M.deadBark, 15 + i * 0.3, D + 1.1, -8.7, { rz: 0.15 });

  // ---- The old bridge (landmark) -------------------------------------------------------------
  const S = SWAMP.step, steps = 7, run = 0.5, bw = 1.5;
  const top = D + S * steps;
  const zSouth = -10, zDeck0 = zSouth - steps * run;
  const zDeck1 = -28.5, zNorth = zDeck1 - steps * run;
  const tread = (x0, z0, x1, z1, y) => {
    solid(x0, z0, x1, z1, 0, y, { deck: true });
    plankDeck(x0, z0, x1, z1, y, { posts: false, wear: 0 });
    // Riser and side stringers in heavy timber.
    add(tiledBox(x1 - x0, S, 0.06, 1), M.beam, (x0 + x1) / 2, y - S / 2, z1 + (z1 > zDeck0 ? 0 : -0.03));
  };
  for (let i = 1; i <= steps; i++) {
    tread(-bw, zSouth - i * run, bw, zSouth - (i - 1) * run, D + S * i);
    tread(-bw, zDeck1 - (steps - i + 1) * run, bw, zDeck1 - (steps - i) * run, D + S * i);
  }
  for (const s of [-1, 1]) {   // sloped stair stringers
    for (const [za, zb] of [[zSouth, zDeck0], [zDeck1, zNorth]]) {
      const len = Math.hypot(za - zb, top - D);
      add(tiledBox(0.12, 0.3, len, 1), M.beam, s * (bw + 0.06), (top + D) / 2 - 0.15, (za + zb) / 2,
        { rx: Math.atan2(top - D, za - zb) * (za === zSouth ? 1 : -1) });
    }
  }
  solid(-bw, zDeck1, bw, zDeck0, top - 0.3, top, { deck: true });
  plankDeck(-bw, zDeck1, bw, zDeck0, top, { posts: false, wear: 0.04 });
  const deckMarker = new THREE.Object3D(); deckMarker.name = 'bridge-deck'; root.add(deckMarker);
  // Main girders under the deck and X-braced timber piers in the channel.
  for (const x of [-bw + 0.2, bw - 0.2]) add(tiledBox(0.25, 0.35, zDeck0 - zDeck1, 1), M.beam, x, top - 0.45, (zDeck0 + zDeck1) / 2);
  for (const z of [-17, -21, -25]) {
    for (const x of [-bw + 0.3, bw - 0.3]) {
      solid(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, top - 0.3);
      add(tiledBox(0.35, top - 0.3, 0.35, 1), M.beam, x, (top - 0.3) / 2, z);
    }
    for (const s of [-1, 1]) add(tiledBox(0.1, 0.1, 3.1, 1), M.beam, 0, (top - 0.3) / 2, z, { ry: Math.PI / 2, rz: s * 0.55 });
  }
  // Railings: posts every 1.5 m with a top rail and a mid rail.
  for (const x of [-bw - 0.05, bw + 0.05]) {
    solid(x - 0.05, zDeck1, x + 0.05, zDeck0, top, top + 1.0);
    for (let z = zDeck1; z <= zDeck0 + 0.01; z += 1.5) add(tiledBox(0.1, 1.0, 0.1, 1), M.beam, x, top + 0.5, z);
    add(tiledBox(0.08, 0.1, zDeck0 - zDeck1, 1), M.beam, x, top + 0.98, (zDeck0 + zDeck1) / 2);
    const mid = add(tiledBox(0.06, 0.08, zDeck0 - zDeck1, 1), M.beam, x, top + 0.5, (zDeck0 + zDeck1) / 2);
    mid.rotation.x = 0.02;   // a little sag
  }
  // End towers: timber posts with cross braces and a lintel, lantern hanging under it.
  for (const z of [zDeck0 - 0.3, zDeck1 + 0.3]) {
    for (const x of [-bw - 0.3, bw + 0.3]) {
      solid(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, top + 4);
      add(tiledBox(0.35, top + 4, 0.35, 1), M.beam, x, (top + 4) / 2, z);
    }
    add(tiledBox(2 * bw + 1.2, 0.4, 0.4, 1), M.beam, 0, top + 3.7, z);
    for (const s of [-1, 1]) add(tiledBox(1.6, 0.12, 0.12, 1), M.beam, s * (bw - 0.4), top + 3.1, z, { rz: s * 0.7 });
    // Lantern: little cage + glowing core + warm light.
    const lampY = top + 3.0;
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 3), M.beam, 0, lampY + 0.45, z, { shadow: false });
    add(new THREE.BoxGeometry(0.28, 0.36, 0.28), new THREE.MeshStandardMaterial({ color: 0x2a2420, wireframe: true }), 0, lampY, z, { shadow: false });
    add(new THREE.BoxGeometry(0.16, 0.2, 0.16), new THREE.MeshBasicMaterial({ color: 0xffb060 }), 0, lampY, z, { shadow: false });
    const lamp = new THREE.PointLight(0xff8a3a, 7, 20, 1.5);
    lamp.position.set(0, lampY - 0.1, z);
    root.add(lamp);
  }

  walk(-1, -40, 1, zNorth, 'north-walk');
  walk(-7, -47, 7, -40, 'north-platform');
  // Derelict water tower: four leaning legs, cross bracing, a wooden tank with a tin cone roof.
  for (const [x, z] of [[-3, -46], [2, -46], [-3, -42], [2, -42]]) {
    solid(x, z, x + 0.4, z + 0.4, D, D + 6);
    add(tiledBox(0.3, 6, 0.3, 1), M.beam, x + 0.2, D + 3, z + 0.2);
  }
  for (const [x, z, ry] of [[-0.3, -45.8, 0], [-0.3, -41.8, 0], [-2.8, -44, Math.PI / 2], [2.2, -44, Math.PI / 2]]) {
    for (const s of [-1, 1]) add(tiledBox(5.5, 0.12, 0.12, 1), M.beam, x, D + 3, z, { ry, rz: s * 0.85 });
  }
  const tankGeo = new THREE.CylinderGeometry(3.1, 3.1, 3, 10, 1, true);
  tankGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 === 0 ? v * 5 : v * 2.5; });
  add(tankGeo, pixelMaterial(boardWallTexture(), { side: THREE.DoubleSide }), -0.3, D + 7.5, -43.8, { name: 'water-tower' });
  solid(-3.6, -46.6, 3, -41, D + 6, D + 9);
  add(new THREE.CylinderGeometry(3.1, 3.1, 0.2, 10), M.beam, -0.3, D + 6.1, -43.8);
  add(new THREE.ConeGeometry(3.4, 1.4, 10), M.roof, -0.3, D + 9.7, -43.8);
  for (const a of [0, 1.7, 3.6]) add(tiledBox(0.08, 3.2, 0.1, 1), M.beam, -0.3 + Math.cos(a) * 3.15, D + 7.5, -43.8 + Math.sin(a) * 3.15, { ry: -a });

  // ---- Cypress trees -------------------------------------------------------------------------
  const nearDeck = (x, z, pad) => decks.some((b) => x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad);
  // Flared, buttressed trunk profile (lathe), bark tiled around it.
  const trunkGeo = (rad, h) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, y = t * h;
      const flare = 1 + 1.6 * Math.pow(1 - Math.min(1, t * 4), 2);
      pts.push(new THREE.Vector2(rad * (1 - 0.55 * t) * flare, y));
    }
    const g = new THREE.LatheGeometry(pts, 7);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * h / 2);
    return g;
  };
  const mossGeo = (() => {
    const a = new THREE.PlaneGeometry(0.6, 1.4); a.translate(0, -0.7, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    return mergeGeometries([a, b]);
  })();
  const mossBatch = batch('moss', mossGeo, M.moss, { shadow: false });
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const crownBatch = batch('crown', crownGeo, M.foliage);
  const limbGeo = tiledBox(0.12, 0.12, 1, 2);
  limbGeo.translate(0, 0, 0.5);
  const limbBatches = [batch('limb', limbGeo, M.bark), batch('deadlimb', limbGeo, M.deadBark)];
  // Feathery foliage sprays hanging under each crown clump (two crossed cards, top at origin).
  const sprayGeo = (() => {
    const a = new THREE.PlaneGeometry(1.5, 1.5); a.translate(0, -0.6, 0);
    return mergeGeometries([a, a.clone().rotateY(Math.PI / 2)]);
  })();
  const sprayBatches = M.spray.map((m, i) => batch(`spray${i}`, sprayGeo, m));
  const longMossGeo = (() => {
    const a = new THREE.PlaneGeometry(0.55, 2.4); a.translate(0, -1.2, 0);
    return mergeGeometries([a, a.clone().rotateY(Math.PI / 2)]);
  })();
  const longMossBatch = batch('longMoss', longMossGeo, M.longMoss, { shadow: false });
  const kneeGeo = new THREE.ConeGeometry(0.12, 1, 5);
  kneeGeo.translate(0, 0.5, 0);
  const kneeBatch = batch('knee', kneeGeo, M.bark);
  const trunkGeos = [0, 1, 2].map((i) => trunkGeo(0.45, 1));   // unit height, scaled per tree

  function tree(x, z, rad, h, dead, far = false) {
    const t = add(trunkGeos[0], dead ? M.deadBark : M.bark, x, -0.2, z, { ry: r() * 6 });
    t.scale.set(rad / 0.45, h, rad / 0.45);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - rad, 0, z - rad), new THREE.Vector3(x + rad, h, z + rad)));
    const limbs = dead ? 4 : 5;
    for (let k = 0; k < limbs; k++) {
      const a = r() * Math.PI * 2, y = h * (0.5 + r() * 0.45), len = 1.4 + r() * 2.2, up = -0.35 - r() * 0.5;
      put(limbBatches[dead ? 1 : 0], x, y, z, a, up, 0, 1, 1, len);
      const ex = x + Math.sin(a) * Math.cos(up) * len, ez = z + Math.cos(a) * Math.cos(up) * len, ey = y - Math.sin(up) * len;
      if (!dead) {
        // Flat, layered crown clumps at the limb ends (cypress canopy is flat-topped).
        // A few overlapping clumps per limb end so the canopy reads as foliage, not plates.
        for (let c = 0; c < 3; c++) {
          const s = 0.6 + r() * 0.6, g = 0.8 + r() * 0.4;
          const cx = ex + (r() - 0.5) * 1.4, cy = ey + 0.1 + r() * 0.5, cz = ez + (r() - 0.5) * 1.4;
          put(crownBatch, cx, cy, cz, r() * 6, r(), 0, s * 1.2, s * 0.7, s * 1.2, new THREE.Color(g, g * 1.05, g));
          // Feathery sprays drooping from under the clump break up its rounded silhouette.
          for (let k = 0; k < (far ? 0 : 2); k++) {   // none on the far treeline (unseen detail, saves fill)
            const a2 = ra() * 6.28, d2 = s * (0.6 + ra() * 0.5);
            put(sprayBatches[ra() < 0.75 ? 0 : 1], cx + Math.cos(a2) * d2, cy - s * 0.2, cz + Math.sin(a2) * d2, ra() * 6, 0, 0, 0.8 + ra() * 0.6, 0.8 + ra() * 0.6, 1);
          }
        }
      }
      // Spanish moss hanging off the limb: short tufts and long trailing curtains.
      // (Same draws from `r` as before so the layout doesn't shift; the choice comes from `ra`.)
      for (let m = 0; m < 2; m++) {
        const f = 0.4 + r() * 0.6;
        const long = ra() < 0.45;
        put(long ? longMossBatch : mossBatch, x + (ex - x) * f, y + (ey - y) * f - 0.05, z + (ez - z) * f, r() * 3, 0, 0, 0.8 + r() * 0.6, (long ? 0.6 : 0.7) + r() * 0.9, 1);
      }
      if (ra() < 0.6) {   // an extra trailing curtain on most limbs
        const f = 0.5 + ra() * 0.5;
        put(longMossBatch, x + (ex - x) * f, y + (ey - y) * f - 0.05, z + (ez - z) * f, ra() * 3, 0, 0, 0.8 + ra() * 0.5, 0.6 + ra() * 0.8, 1);
      }
    }
    if (!dead) for (let c = 0; c < 4; c++) put(crownBatch, x + (r() - 0.5) * 2, h + r() * 0.6, z + (r() - 0.5) * 2, r() * 6, r(), 0, 1.3, 0.8, 1.3, new THREE.Color(1, 1.05, 1));
    for (let k = 0; k < 4; k++) {   // knees poking out of the water around the base
      const a = r() * 6, d = rad * 2 + r() * 1.6;
      put(kneeBatch, x + Math.cos(a) * d, 0, z + Math.sin(a) * d, r() * 6, (r() - 0.5) * 0.2, 0, 1, 0.45 + r() * 0.4, 1);
    }
  }
  let placed = 0;
  for (let i = 0; i < 500 && placed < 85; i++) {
    const x = (r() * 2 - 1) * (H - 3), z = (r() * 2 - 1) * (H - 3);
    if (nearDeck(x, z, 2.5) || (Math.abs(x) < 3 && z > -34 && z < -8)) continue;
    tree(x, z, 0.25 + r() * 0.35, 6 + r() * 8, r() < 0.3);
    placed++;
  }
  tree(4, -4, 0.55, 12, false);    // the island's big old cypress
  // Treeline just outside the walls so the map edge reads as forest, not a wall.
  for (let i = 0; i < 70; i++) {
    const side = i % 4, t = (r() * 2 - 1) * H;
    const off = H + 1.5 + r() * 4;
    const [x, z] = side === 0 ? [t, -off] : side === 1 ? [t, off] : side === 2 ? [-off, t] : [off, t];
    tree(x, z, 0.35 + r() * 0.3, 9 + r() * 8, r() < 0.2, true);
  }

  // ---- Reeds, cattails and lily pads ---------------------------------------------------------
  const reedGeo = (() => {
    const a = new THREE.PlaneGeometry(1.4, 1.4); a.translate(0, 0.7, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const c = a.clone().rotateY(Math.PI / 4);
    return mergeGeometries([a, b, c]);
  })();
  const reedBatches = [0, 1].map((v) => batch(`reed${v}`, reedGeo, M.reeds[v], { shadow: false }));
  const reed = (x, z, s = 1) => {
    const g = 0.75 + r() * 0.4;
    put(reedBatches[r() < 0.7 ? 0 : 1], x, 0.05, z, r() * 6, 0, 0, s * (0.8 + r() * 0.5), s * (0.8 + r() * 0.7), s, new THREE.Color(g, g, g));
  };
  // Clusters along boardwalk edges and island rims, plus scattered stands in open water.
  for (const b of decks) {
    if (b.max.y > 0.5) continue;
    const per = 2 * ((b.max.x - b.min.x) + (b.max.z - b.min.z));
    const n = Math.floor(per / 3);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(r() * 4);
      const x = side < 2 ? b.min.x + r() * (b.max.x - b.min.x) : side === 2 ? b.min.x - 0.4 - r() * 1.2 : b.max.x + 0.4 + r() * 1.2;
      const z = side >= 2 ? b.min.z + r() * (b.max.z - b.min.z) : side === 0 ? b.min.z - 0.4 - r() * 1.2 : b.max.z + 0.4 + r() * 1.2;
      if (r() < 0.6) reed(x, z);
    }
  }
  for (let i = 0; i < 70; i++) {
    const cx = (r() * 2 - 1) * (H - 2), cz = (r() * 2 - 1) * (H - 2);
    if (nearDeck(cx, cz, 0.6)) continue;
    const n = 3 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * 3, z = cz + (r() - 0.5) * 3;
      if (!nearDeck(x, z, 0.3)) reed(x, z, 0.9 + r() * 0.5);
    }
  }
  const lilyBatch = batch('lily', new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), M.lily, { shadow: false });
  const lilyFlowerBatch = batch('lilyFlower', new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), M.lilyFlower, { shadow: false });
  for (let i = 0; i < 60; i++) {
    const cx = (r() * 2 - 1) * (H - 2), cz = (r() * 2 - 1) * (H - 2);
    if (nearDeck(cx, cz, 0.4)) continue;
    for (let k = 0; k < 6; k++) put(ra() < 0.14 ? lilyFlowerBatch : lilyBatch, cx + (r() - 0.5) * 2.5, W + 0.012, cz + (r() - 0.5) * 2.5, r() * 6, 0, 0, 0.6 + r() * 0.9, 1, 0.6 + r() * 0.9);
  }

  // ---- Art #40 dressing from the forest kit: drowned logs, dead snags standing in the water,
  // and undergrowth on the mud islands. Uses its own random stream (ra). ----------------------
  const kit = new ForestKit(4041);
  const inDeep = (x, z) => DEEP.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
  for (let i = 0, n = 0; i < 600 && n < 22; i++) {
    const x = (ra() * 2 - 1) * (H - 4), z = (ra() * 2 - 1) * (H - 4), rot = ra() * Math.PI;
    const len = 3 + ra() * 6, dia = 0.4 + ra() * 0.45;
    const ends = [-0.5, 0.5].map((t) => [x + Math.cos(rot) * t * len, z - Math.sin(rot) * t * len]);
    if (ends.some(([ex, ez]) => nearDeck(ex, ez, 1.2)) || nearDeck(x, z, 1.2)) continue;
    // Mostly drowned: just the top of the log breaks the surface, one end often sunk deeper.
    const sink = inDeep(x, z) ? 0.1 : 0.25;
    kit.add(ra() < 0.6 ? 'log:1' : 'log:3', x, W - dia * sink, z, rot, [len, dia, dia], { x: 0, z: (ra() - 0.5) * 0.12 });
    n++;
  }
  for (let i = 0, n = 0; i < 400 && n < 14; i++) {
    const x = (ra() * 2 - 1) * (H - 4), z = (ra() * 2 - 1) * (H - 4);
    if (nearDeck(x, z, 2.5)) continue;
    const h = 5 + ra() * 7;
    kit.add('snag:1', x, -0.3, z, ra() * 6.28, [h * 1.1, h, h * 1.1], { x: (ra() - 0.5) * 0.12, z: (ra() - 0.5) * 0.12 });
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.25, 0, z - 0.25), new THREE.Vector3(x + 0.25, h, z + 0.25)));
    n++;
  }
  for (const [x0, z0, x1, z1] of islands) {
    const area = (x1 - x0) * (z1 - z0);
    for (let k = 0; k < area * 0.5; k++) {
      const x = x0 + 0.3 + ra() * (x1 - x0 - 0.6), z = z0 + 0.3 + ra() * (z1 - z0 - 0.6);
      const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      if (edge > 1.6 && ra() < 0.6) continue;          // thickest around the rim
      kit.add('grass:1', x, D, z, ra() * 6.28, 0.8 + ra() * 0.7);
    }
    for (let k = 0; k < area * 0.08; k++) {
      const x = x0 + 0.5 + ra() * (x1 - x0 - 1), z = z0 + 0.5 + ra() * (z1 - z0 - 1);
      kit.add(ra() < 0.6 ? 'fern:1' : 'fern:0', x, D, z, ra() * 6.28, 0.8 + ra() * 0.5);
    }
    for (let k = 0; k < Math.max(1, area * 0.02); k++) {
      kit.add('rock:4', x0 + ra() * (x1 - x0), D - 0.08, z0 + ra() * (z1 - z0), ra() * 6.28, 0.5 + ra() * 0.6);
    }
  }
  const kitGroup = kit.build(root);
  const swayer = kitGroup.children.find((c) => c.name.startsWith('kit-grass')) ?? kitGroup.children[0];
  if (swayer) swayer.onBeforeRender = () => { kit.wind.value = performance.now() / 1000; };

  // ---- Swamp fog: drifting low mist banks over the water ---------------------------------
  root.add(buildFogBanks({ half: H, water: W, rand: ra }));

  // ---- Fireflies over the water: tiny unlit pixels that drift (cheap ambience) --------------
  const nFly = 90, flyPos = new Float32Array(nFly * 3), flyBase = [];
  for (let i = 0; i < nFly; i++) {
    const p = [(r() * 2 - 1) * H, 0.6 + r() * 2.2, (r() * 2 - 1) * H];
    flyBase.push([...p, r() * 6]);
    flyPos.set(p, i * 3);
  }
  const flyGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 2, sizeAttenuation: false, fog: true, transparent: true, opacity: 0.85 }));
  flies.frustumCulled = false;
  flies.onBeforeRender = () => {
    const t = performance.now() / 1000;
    for (let i = 0; i < nFly; i++) {
      const [x, y, z, ph] = flyBase[i];
      flyPos[i * 3] = x + Math.sin(t * 0.3 + ph) * 1.2;
      flyPos[i * 3 + 1] = y + Math.sin(t * 0.7 + ph * 2) * 0.3;
      flyPos[i * 3 + 2] = z + Math.cos(t * 0.25 + ph) * 1.2;
    }
    flyGeo.attributes.position.needsUpdate = true;
  };
  root.add(flies);

  // ---- Build the instanced batches ----------------------------------------------------------
  for (const [key, b] of batches) {
    if (!b.mats.length) continue;
    const im = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
    b.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, b.cols[i]); });
    im.castShadow = b.shadow; im.receiveShadow = true;
    im.name = `swamp-${key}`;
    im.computeBoundingSphere();
    root.add(im);
  }

  // Style guide rule 2: every painted texture in the swamp uses master-palette colours only.
  root.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) if (m?.map?.image?.getContext) snapTextureToPalette(m.map);
  });

  /** What the player is standing in at (x, z, feetY): 'dry' | 'shallow' | 'deep'. */
  const surfaceAt = (x, z, y = 0) => {
    if (y > W - 0.1) return 'dry';
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
    // Swamp night: sickly green-grey haze, a low pale moon, warm lamps as the only warm colour.
    environment: {
      background: 0x141d18, fog: { color: 0x141d18, near: 6, far: 38 }, lightLevel: 0.05,
      night: {
        moonColor: 0xb4c8c0, moonIntensity: 0.75, moonDir: [-0.35, 0.38, -1],
        ambientSky: 0x2e4436, ambientGround: 0x0a0d0a, ambientIntensity: 0.7,
        fogColor: 0x18231d, fogDensity: 0.04, skyHorizon: 0x1d2b23, skyZenith: 0x050807, moonGlow: 0x4e6658,
      },
    },
  };
}

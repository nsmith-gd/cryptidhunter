import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pixelTexture, pixelMaterial, plankTexture, metalTexture } from '../art/pixelTex.js';
import { pineBarkTexture, rockTexture } from '../art/forestTex.js';
import { RAMPS } from '../art/palette.js';

// Pine Hollow: the GDD map pieces the greybox was missing (art #91; GDD 12.1–12.3, 13.2, 16.4).
//   - Trailhead hub: a roofed map board with a lantern (a lit, safe pool of light at the start).
//   - A readable, physical edge: a post-and-wire boundary fence with yellow property-line signs.
//   - An observation point: a hunter's tree stand you can climb, overlooking the hollow trail.
//   - Traces that build a risk gradient: snapped saplings and a dropped pack by the creek, then
//     scratch marks above head height, stick structures and a cairn past the ridge, then a
//     snapped pine and a bed of torn branches in the hollow itself.
//   - Wet ground: glossy puddles in the trail ruts near the creek and in the hollow.
// Everything here is dressing: no clue logic (that's the clue system's), merged per material so
// it costs a handful of draw calls. ?nolandmarks turns it off for before/after comparisons.

export const LANDMARKS = {
  fenceInset: 5,          // the fence runs this far inside the map edge
  postEvery: 10,          // m between fence posts
  signEvery: 60,          // m between property-line signs
  stand: { height: 3.2, rise: 0.32, run: 0.36 }, // tree-stand platform and stair steps (player steps up 0.36 m)
};

/** Point along a→b at fraction t, pushed `side` metres to the left (+) or right (−) of travel. */
export function beside(a, b, t, side) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  return { x: a.x + dx * t + (-dz / len) * side, z: a.z + dz * t + (dx / len) * side, faceYaw: Math.atan2(dz, dx) };
}

/** Where everything goes (pure; tested). L: the map's landmark points. */
export function planLandmarks(L, half) {
  const P = (x, z) => ({ x, z });
  const ridgeCut = P(22, -40), hollowJn = P(14, -85);
  const spots = {
    kiosk: beside(L.trailhead, L.fork, 0.22, -5.5),                 // west of the trail, board facing it
    trashBin: beside(L.trailhead, L.fork, 0.05, -6.5),
    droppedPack: beside(L.cabin, P(-80, 5), 0.93, 4.5),           // by the west ford: someone left in a hurry
    sapling1: beside(P(40, 45), L.footbridge, 0.45, -4.2),         // low risk: south of the creek
    sapling2: beside(P(30, -10), ridgeCut, 0.25, 4.2),
    scratchTree: beside(P(30, -10), ridgeCut, 0.6, -4.6),          // marks higher than a person can reach
    teepee: beside(ridgeCut, P(-40, -30), 0.45, 5),                // stick structure off the west loop
    cairn: beside(P(-40, -30), L.boulders, 0.75, -4.5),
    xArch: beside(L.ridgePass, hollowJn, 0.5, -5.5),               // past the ridge: its territory
    treeStand: beside(hollowJn, L.hollow, 0.32, 7),                // observation point over the hollow trail
    snappedPine: beside(P(-45, -115), L.hollow, 0.55, -6.5),
    bedding: { x: L.hollow.x + 5, z: L.hollow.z - 6 },
    teepee2: { x: L.hollow.x - 11, z: L.hollow.z - 7 },
  };
  // Puddles: in the ruts where the trails come down to the creek, and in the hollow's wallow.
  const puddles = [
    beside(P(40, 45), L.footbridge, 0.78, 0.6), beside(P(40, 45), L.footbridge, 0.7, -0.5),
    beside(L.footbridge, P(30, -10), 0.18, 0.3), beside(L.footbridge, P(30, -10), 0.3, -0.6),
    beside(L.cabin, P(-70, 40), 0.9, 0.2), beside(P(-70, 40), P(-80, 5), 0.55, -0.4),
    beside(P(-70, 40), P(-80, 5), 0.85, 0.5), beside(ridgeCut, P(-40, -30), 0.12, 0.3),
    { x: L.hollow.x + 2, z: L.hollow.z + 3 }, { x: L.hollow.x - 4, z: L.hollow.z + 7 }, { x: L.hollow.x + 7, z: L.hollow.z + 1 },
  ].map((p, i) => ({ ...p, r: 0.7 + ((i * 37) % 10) / 10 }));
  // Footprints of each prop that trees and bushes must keep off (centre + radius).
  const clear = [
    [spots.kiosk, 3], [spots.trashBin, 2], [spots.droppedPack, 2], [spots.sapling1, 1.6], [spots.sapling2, 1.6],
    [spots.scratchTree, 1.4], [spots.teepee, 2.6], [spots.cairn, 1.8], [spots.xArch, 3], [spots.treeStand, 3.5],
    [{ x: spots.treeStand.x, z: spots.treeStand.z + 3.6 }, 2.6],
    [spots.snappedPine, 6], [spots.teepee2, 2.6],
  ].map(([p, r]) => ({ x: p.x, z: p.z, r }));
  const f = half - LANDMARKS.fenceInset;
  return { spots, puddles, clear, fence: f };
}

// ---- Pixel textures (master palette ramps; crisp texels) -----------------------------------

/** Draw canvas text, then snap it to hard pixels (no anti-aliased edges). */
function hardText(g, text, x, y, font, col, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = c.getContext('2d');
  t.font = font; t.textBaseline = 'top'; t.fillStyle = '#fff'; t.fillText(text, x, y);
  const d = t.getImageData(0, 0, w, h).data;
  g.fillStyle = col;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 110) g.fillRect(i, j, 1, 1);
}

function boundarySignTexture() {
  return pixelTexture('t91-boundarySign', 48, 32, (g, px, r, w, h) => {
    const Y = ['#5a4a14', '#9a8424', '#c9ad38', '#e2c95a'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, Y[2 + (r() < 0.18 ? 1 : 0) - (r() < 0.08 ? 1 : 0)]);
    for (let x = 0; x < w; x++) { px(x, 0, Y[0]); px(x, h - 1, Y[0]); }
    for (let y = 0; y < h; y++) { px(0, y, Y[0]); px(w - 1, y, Y[0]); }
    hardText(g, 'PROPERTY', 4, 4, 'bold 9px monospace', RAMPS.rock[0], w, h);
    hardText(g, 'LINE', 13, 13, 'bold 9px monospace', RAMPS.rock[0], w, h);
    g.fillStyle = RAMPS.rock[0]; g.fillRect(4, 25, 40, 2);
    for (let k = 0; k < 14; k++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); px(x, y, RAMPS.rust[2 + (k % 3)]); px(x, y + 1, RAMPS.rust[2]); } // rust spots, drips
    for (const [nx, ny] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) px(nx, ny, RAMPS.rock[5]);
  }, { seed: 9101 });
}

function mapBoardTexture() {
  return pixelTexture('t91-mapBoard', 64, 40, (g, px, r, w, h) => {
    const N = RAMPS.needles, W = RAMPS.wood;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, N[3 + ((x * 7 + y * 3) % 11 === 0 ? 1 : 0)]);
    // Ridge band, creek, trails, landmarks, "you are here".
    for (let x = 0; x < w; x++) { const z = 12 + Math.round(Math.sin(x * 0.3) * 1.2); px(x, z, RAMPS.rock[4]); px(x, z + 1, RAMPS.rock[3]); }
    for (let x = 0; x < w; x++) { const z = 22 + Math.round(Math.sin(x * 0.18) * 2); px(x, z, RAMPS.water[5]); px(x, z + 1, RAMPS.water[4]); }
    const line = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) px(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), W[6]); };
    line(32, 37, 32, 33); line(32, 33, 22, 30); line(32, 33, 40, 24); line(40, 24, 34, 6); line(34, 6, 30, 3); line(36, 15, 14, 14); line(14, 14, 10, 4); line(10, 4, 30, 3); line(34, 6, 48, 5);
    for (const [x, y] of [[22, 30], [46, 30], [14, 14], [48, 5], [30, 3]]) { px(x, y, W[1]); px(x + 1, y, W[1]); px(x, y + 1, W[1]); px(x + 1, y + 1, W[1]); }
    px(32, 36, '#d0361c'); px(33, 36, '#d0361c'); px(32, 37, '#d0361c'); px(33, 37, '#d0361c'); // you are here
    for (let x = 0; x < w; x++) { px(x, 0, W[1]); px(x, h - 1, W[1]); }
    for (let y = 0; y < h; y++) { px(0, y, W[1]); px(w - 1, y, W[1]); }
    for (let k = 0; k < 40; k++) px(Math.floor(r() * w), Math.floor(r() * h), RAMPS.lichen[0]); // weathering
  }, { seed: 9102 });
}

/** Bark panel with four pale claw gouges (alpha around them so it lays on a trunk). */
function scratchTexture() {
  return pixelTexture('t91-scratch', 16, 32, (g, px, r, w, h) => {
    const B = RAMPS.bark;
    for (let k = 0; k < 4; k++) {
      const x0 = 2 + k * 3 + (k > 1 ? 1 : 0), y0 = 3 + (k % 2) * 2, len = 22 + Math.floor(r() * 5);
      for (let i = 0; i < len; i++) {
        const x = x0 + Math.round(i * 0.12), y = y0 + i;
        px(x, y, i < 3 ? B[5] : RAMPS.wood[6]); px(x + 1, y, r() < 0.5 ? RAMPS.wood[5] : B[5]); px(x - 1, y, B[0]); px(x + 2, y, B[1]);
      }
    }
  }, { seed: 9103, alpha: true });
}

function trashTexture() {
  return pixelTexture('t91-litter', 16, 16, (g, px, r, w, h) => {
    const cols = ['#c9c2b0', '#9a3f17', '#3a5068', '#d0661c', '#e2dccb'];
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(r() * 13), y = Math.floor(r() * 13), c = cols[k % cols.length], s = 1 + Math.floor(r() * 3);
      for (let j = 0; j < s; j++) for (let i = 0; i < s + 1; i++) px(x + i, y + j, c);
      px(x, y + s, RAMPS.rock[0]);
    }
  }, { seed: 9104, alpha: true });
}

function packTexture() {
  return pixelTexture('t91-pack', 16, 16, (g, px, r, w, h) => {
    const R = ['#3a1f17', '#5e2f1a', '#7e4422', '#9a3f17'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, R[1 + (r() < 0.3 ? 1 : 0)]);
    for (let x = 0; x < w; x++) { px(x, 5, R[0]); px(x, 6, R[3]); }
    for (let y = 7; y < h; y++) { px(4, y, R[0]); px(11, y, R[0]); }
    px(7, 9, RAMPS.rock[5]); px(8, 9, RAMPS.rock[5]);
  }, { seed: 9105 });
}

// ---- Geometry helpers ----------------------------------------------------------------------

/** Box with UVs scaled to real size (`tile` metres per texture repeat) and placed. */
function boxGeo(w, h, d, tile, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su / tile, uv.getY(i) * sv / tile);
  }
  return place(g, x, y, z, rx, ry, rz);
}
function cylGeo(r0, r1, len, tile, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 6 } = {}) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * Math.max(r0, r1)) / tile, uv.getY(i) * len / tile);
  return place(g, x, y, z, rx, ry, rz);
}
function place(g, x, y, z, rx, ry, rz) {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
  g.translate(x, y, z);
  return g.index ? g.toNonIndexed() : g;
}
/** A stick from point a to point b (both {x,y,z}). */
function stick(a, b, r, tile) {
  const v = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z), len = v.length();
  const g = new THREE.CylinderGeometry(r * 0.75, r, len, 5, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / tile, uv.getY(i) * len / tile);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g.toNonIndexed();
}

// ---- Build ---------------------------------------------------------------------------------

/**
 * Add the landmarks to the scene. Returns { group, stats, standTop, lights }.
 * colliders: the map's AABB list (fence, kiosk posts, tree stand and its stairs are solid).
 */
export function buildLandmarks(scene, colliders, plan, { heightAt = () => 0, rng = Math.random } = {}) {
  const { spots: S, puddles, fence } = plan;
  const group = new THREE.Group();
  group.name = 'pine-hollow-landmarks';
  const parts = { wood: [], plank: [], bark: [], rock: [], metal: [], sign: [], board: [], pack: [] };
  const cards = [];   // alpha cards (scratches, litter) need their own meshes
  const solid = (x0, y0, z0, x1, y1, z1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  const yAt = (x, z) => heightAt(x, z);

  // Trailhead kiosk: two posts, a shingled roof, the map board facing the trail, a lantern.
  {
    const { x, z } = S.kiosk; // the board faces +x, toward the trail
    for (const dz of [-1.3, 1.3]) {
      parts.wood.push(boxGeo(0.18, 2.7, 0.18, 1, { x, y: 1.35, z: z + dz }));
      solid(x - 0.12, 0, z + dz - 0.12, x + 0.12, 2.7, z + dz + 0.12);
    }
    parts.plank.push(boxGeo(0.1, 1.2, 2.5, 1, { x: x - 0.05, y: 1.55, z }));
    parts.board.push(rawBox(0.02, 1.05, 2.3, x + 0.01, 1.55, z));
    parts.plank.push(boxGeo(1.1, 0.08, 3.2, 1, { x: x + 0.15, y: 2.82, z, rz: -0.28 }));
    parts.plank.push(boxGeo(0.12, 0.12, 2.5, 1, { x: x + 0.12, y: 0.95, z }));  // ledge under the board
    // Lantern on a hook over the board.
    parts.metal.push(boxGeo(0.16, 0.24, 0.16, 0.5, { x: x + 0.45, y: 2.32, z: z + 0.9 }));
    parts.metal.push(boxGeo(0.4, 0.04, 0.04, 0.5, { x: x + 0.25, y: 2.5, z: z + 0.9 }));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: RAMPS.warm[4] }));
    glow.position.set(x + 0.45, 2.3, z + 0.9);
    group.add(glow);
    const lamp = new THREE.PointLight(0xffb870, 3.2, 11, 1.6);
    lamp.position.set(x + 0.6, 2.25, z + 0.9);
    lamp.name = 'kiosk-lantern';
    group.add(lamp);
  }

  // Tipped-over trash bin with litter spilled toward the woods.
  {
    const { x, z } = S.trashBin;
    parts.metal.push(cylGeo(0.42, 0.42, 1.0, 0.5, { x, y: 0.42, z, rz: Math.PI / 2, ry: 0.5, seg: 8 }));
    parts.metal.push(boxGeo(0.9, 0.06, 0.9, 0.5, { x: x + 0.9, y: 0.04, z: z - 0.6, ry: 0.9 }));   // the lid, thrown
    for (let i = 0; i < 4; i++) cards.push({ tex: trashTexture(), w: 1.1, d: 1.1, x: x - 0.4 - i * 0.9, z: z + 0.2 + (i % 2) * 0.5, ry: i });
  }

  // Dropped backpack and a flashlight still on, by the west ford.
  {
    const { x, z } = S.droppedPack;
    parts.pack.push(boxGeo(0.55, 0.32, 0.38, 0.5, { x, y: 0.18, z, ry: 0.7, rz: 0.25 }));
    parts.metal.push(cylGeo(0.05, 0.045, 0.3, 0.5, { x: x + 0.8, y: 0.05, z: z + 0.4, rz: Math.PI / 2, ry: 2.4, seg: 6 }));
    const beam = new THREE.SpotLight(0xfff0d0, 5, 9, 0.38, 0.5, 1.6);
    beam.position.set(x + 0.8, 0.12, z + 0.4);
    beam.target.position.set(x + 0.8 + Math.cos(2.4) * 4, 0, z + 0.4 - Math.sin(2.4) * 4);
    beam.name = 'dropped-flashlight';
    group.add(beam, beam.target);
  }

  // Snapped saplings: stump with splintered top, broken top bent over to the ground.
  for (const s of [S.sapling1, S.sapling2]) {
    const { x, z } = s, a = rng() * Math.PI * 2;
    parts.bark.push(cylGeo(0.07, 0.09, 1.5, 1, { x, y: 0.75, z }));
    parts.wood.push(boxGeo(0.06, 0.25, 0.04, 0.5, { x: x + 0.02, y: 1.6, z, rz: 0.3 }));
    parts.bark.push(stick({ x, y: 1.5, z }, { x: x + Math.cos(a) * 2.6, y: 0.05, z: z + Math.sin(a) * 2.6 }, 0.06, 1));
  }

  // Scratch marks on a tree, 2.3–3.1 m up (above any person's reach), plus the trunk itself.
  {
    const { x, z } = S.scratchTree, f = S.scratchTree.faceYaw;
    parts.bark.push(cylGeo(0.36, 0.44, 12, 1, { x, y: 6, z, seg: 8 }));
    solid(x - 0.4, 0, z - 0.4, x + 0.4, 12, z + 0.4);
    // Panel on the side facing the trail.
    const nx = Math.cos(f + Math.PI / 2), nz = Math.sin(f + Math.PI / 2);
    // The tree stands right of the trail, so the trail is on its left (+n) side.
    for (const [k, y] of [[0, 2.75], [0.5, 2.55]]) {
      const a = Math.atan2(nz, nx) + (k - 0.25) * 0.9, ox = Math.cos(a), oz = Math.sin(a);
      cards.push({ tex: scratchTexture(), w: 0.55, h: 1.1, x: x + ox * 0.43, y, z: z + oz * 0.43, ry: Math.atan2(ox, oz), upright: true });
    }
  }

  // Stick structures: a teepee of leaning branches, and an X-arch of crossed bent saplings.
  for (const s of [S.teepee, S.teepee2]) {
    const { x, z } = s, n = 7, top = { x, y: 2.6, z };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.4, r = 1.2 + rng() * 0.5;
      parts.bark.push(stick({ x: x + Math.cos(a) * r, y: 0, z: z + Math.sin(a) * r }, { x: top.x + Math.cos(a) * 0.15, y: top.y + rng() * 0.6, z: top.z + Math.sin(a) * 0.15 }, 0.06, 1));
    }
    solid(x - 0.7, 0, z - 0.7, x + 0.7, 2, z + 0.7);
  }
  {
    const { x, z, faceYaw } = S.xArch, c = Math.cos(faceYaw), s = Math.sin(faceYaw);
    for (const k of [-1, 1]) {
      // Two saplings bent over and pinned, crossing in an X over a faint game trail.
      const a = { x: x + c * 2.2 * k - s * 1.2, y: 0, z: z + s * 2.2 * k + c * 1.2 }, b = { x: x - c * 2.2 * k + s * 1.2, y: 0, z: z - s * 2.2 * k - c * 1.2 };
      const m = { x: (a.x + b.x) / 2, y: 2.4, z: (a.z + b.z) / 2 };
      parts.bark.push(stick(a, { x: (a.x + m.x) / 2, y: 1.8, z: (a.z + m.z) / 2 }, 0.07, 1));
      parts.bark.push(stick({ x: (a.x + m.x) / 2, y: 1.8, z: (a.z + m.z) / 2 }, m, 0.06, 1));
      parts.bark.push(stick(m, { x: (b.x + m.x) / 2, y: 1.6, z: (b.z + m.z) / 2 }, 0.05, 1));
      parts.bark.push(stick({ x: (b.x + m.x) / 2, y: 1.6, z: (b.z + m.z) / 2 }, b, 0.045, 1));
    }
  }

  // Cairn: stones stacked by hand (or not) on a boulder.
  {
    const { x, z } = S.cairn;
    let y = 0;
    for (let i = 0; i < 5; i++) {
      const s = 0.55 - i * 0.08;
      parts.rock.push(boxGeo(s * 1.4, s * 0.7, s * 1.1, 1, { x: x + (rng() - 0.5) * 0.08, y: y + s * 0.35, z, ry: rng() * 3 }));
      y += s * 0.68;
    }
    solid(x - 0.4, 0, z - 0.4, x + 0.4, y, z + 0.4);
  }

  // Hunter's tree stand: 4 legs, a railed platform at 3.2 m, and steep plank steps up (each step
  // is at most 0.32 m, so you can walk up). Looks toward the hollow.
  const H = LANDMARKS.stand.height;
  let standTop = null;
  {
    const { x, z } = S.treeStand;
    parts.bark.push(cylGeo(0.4, 0.48, 14, 1, { x: x - 1.5, y: 7, z: z - 1.5, seg: 8 }));          // the pine it's lashed to
    solid(x - 1.95, 0, z - 1.95, x - 1.05, 14, z - 1.05);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.wood.push(boxGeo(0.14, H, 0.14, 1, { x: x + dx, y: H / 2, z: z + dz }));
    parts.plank.push(boxGeo(2.3, 0.12, 2.3, 1, { x, y: H - 0.06, z }));
    solid(x - 1.15, H - 0.12, z - 1.15, x + 1.15, H, z + 1.15);
    // Railing on three sides (north, east, west); the stair comes up from the south.
    for (const [w, d, cx, cz] of [[2.3, 0.08, 0, -1.12], [0.08, 2.3, -1.12, 0], [0.08, 2.3, 1.12, 0]]) {
      parts.plank.push(boxGeo(w, 0.08, d, 1, { x: x + cx, y: H + 0.95, z: z + cz }));
      parts.plank.push(boxGeo(w, 0.08, d, 1, { x: x + cx, y: H + 0.5, z: z + cz }));
      solid(x + cx - w / 2, H, z + cz - d / 2, x + cx + w / 2, H + 1.0, z + cz + d / 2);
    }
    for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) parts.wood.push(boxGeo(0.08, 1.05, 0.08, 1, { x: x + dx, y: H + 0.5, z: z + dz }));
    parts.plank.push(boxGeo(0.8, 0.5, 0.4, 1, { x, y: H + 0.25, z: z - 0.8 }));                     // seat box
    solid(x - 0.4, H, z - 1.0, x + 0.4, H + 0.5, z - 0.6);
    // Stair: from the south edge down and away.
    const { rise, run } = LANDMARKS.stand, steps = Math.ceil(H / rise);
    for (let i = 0; i < steps; i++) {
      const top = H - (i + 1) * rise + rise, z0 = z + 1.15 + i * run;
      const h = Math.max(0.05, top);
      parts.plank.push(boxGeo(0.9, 0.06, run + 0.02, 1, { x, y: h - 0.03, z: z0 + run / 2 }));
      solid(x - 0.45, 0, z0, x + 0.45, h, z0 + run);
    }
    for (const sx of [-0.5, 0.5]) parts.wood.push(stick({ x: x + sx, y: H, z: z + 1.15 }, { x: x + sx, y: 0, z: z + 1.15 + steps * run }, 0.06, 1));
    standTop = { x, y: H, z };
  }

  // Snapped pine at the hollow: a tall stump and the top crashed across the ground.
  {
    const { x, z } = S.snappedPine, a = -2.2;   // falls away from the trail
    parts.bark.push(cylGeo(0.42, 0.5, 3.4, 1, { x, y: 1.7, z, seg: 8 }));
    for (let i = 0; i < 5; i++) parts.wood.push(boxGeo(0.08, 0.5 + rng() * 0.4, 0.06, 0.5, { x: x + Math.cos(i) * 0.3, y: 3.55, z: z + Math.sin(i) * 0.3, rz: (rng() - 0.5) * 0.5 }));
    solid(x - 0.5, 0, z - 0.5, x + 0.5, 3.4, z + 0.5);
    const b = { x: x + Math.cos(a) * 11, y: 0.35, z: z + Math.sin(a) * 11 };
    parts.bark.push(stick({ x: x + Math.cos(a) * 0.6, y: 3.1, z: z + Math.sin(a) * 0.6 }, b, 0.38, 1));
    for (let i = 1; i < 6; i++) {
      const t = i / 6, px = x + Math.cos(a) * 11 * t, pz = z + Math.sin(a) * 11 * t;
      const box = new THREE.Box3(new THREE.Vector3(px - 0.5, 0, pz - 0.5), new THREE.Vector3(px + 0.5, 0.35 + (1 - t) * 2.6, pz + 0.5));
      if (box.max.y > 0.4) colliders.push(box);
    }
  }

  // Bedding: torn-off branches piled in a rough oval next to the nest.
  {
    const { x, z } = S.bedding;
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, r = rng() * 1.3, len = 1.2 + rng() * 1.2, h = 0.08 + rng() * 0.3;
      const cx = x + Math.cos(a) * r * 1.4, cz = z + Math.sin(a) * r, b = rng() * Math.PI;
      parts.bark.push(stick({ x: cx - Math.cos(b) * len / 2, y: h, z: cz - Math.sin(b) * len / 2 }, { x: cx + Math.cos(b) * len / 2, y: h * 0.4, z: cz + Math.sin(b) * len / 2 }, 0.04, 1));
    }
  }

  // Boundary fence: posts every 10 m, two strands of wire, a yellow sign every 60 m. Solid, so
  // the edge of the map is something you can see and touch.
  {
    const step = LANDMARKS.postEvery;
    const posts = [];
    for (let t = -fence; t <= fence + 0.01; t += step) posts.push([t, -fence], [t, fence], [-fence, t], [fence, t]);
    for (const [px, pz] of posts) parts.wood.push(boxGeo(0.12, 1.3, 0.12, 1, { x: px, y: 0.65, z: pz, ry: (px * 7 + pz) % 0.3 }));
    for (const s of [-1, 1]) {
      for (const y of [0.6, 1.1]) {
        parts.metal.push(boxGeo(2 * fence, 0.015, 0.015, 4, { x: 0, y, z: s * fence }));
        parts.metal.push(boxGeo(0.015, 0.015, 2 * fence, 4, { x: s * fence, y, z: 0 }));
      }
      solid(-fence, 0, s * fence - 0.1, fence, 1.4, s * fence + 0.1);
      solid(s * fence - 0.1, 0, -fence, s * fence + 0.1, 1.4, fence);
    }
    const sEvery = LANDMARKS.signEvery;
    for (let t = -fence + sEvery / 2; t < fence; t += sEvery) {
      for (const [sx, sz, ry] of [[t, -fence + 0.08, 0], [t, fence - 0.08, Math.PI], [-fence + 0.08, t, Math.PI / 2], [fence - 0.08, t, -Math.PI / 2]]) {
        parts.sign.push(signGeo(sx, sz, ry));
      }
    }
  }

  // Merge each material's parts into one mesh.
  const M = {
    wood: pixelMaterial(plankTexture(1), { color: 0xb8ab98 }),
    plank: pixelMaterial(plankTexture(0)),
    bark: pixelMaterial(pineBarkTexture()),
    rock: pixelMaterial(rockTexture()),
    metal: pixelMaterial(metalTexture(), { roughness: 0.6, metalness: 0.4, color: 0x9aa0a6 }),
    sign: pixelMaterial(boundarySignTexture(), { roughness: 0.7 }),
    board: pixelMaterial(mapBoardTexture(), { roughness: 0.85 }),
    pack: pixelMaterial(packTexture()),
  };
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list.map(strip)), M[k]);
    m.castShadow = k !== 'sign' && k !== 'board'; m.receiveShadow = true;
    m.name = `landmark-${k}`;
    group.add(m);
  }

  // Alpha cards: litter on the ground, scratches on the bark.
  for (const c of cards) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h ?? c.d), pixelMaterial(c.tex, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    if (c.upright) { m.position.set(c.x, c.y, c.z); m.rotation.y = c.ry; }
    else { m.rotation.x = -Math.PI / 2; m.rotation.z = c.ry; m.position.set(c.x, yAt(c.x, c.z) + 0.02, c.z); }
    m.name = 'landmark-card';
    group.add(m);
  }

  // Puddles: glossy dark water lying in the ruts; catches the moon, lamps and your flashlight.
  {
    const geos = puddles.map((p, i) => {
      const g = new THREE.CircleGeometry(p.r, 9);
      g.scale(1, 0.6 + (i % 3) * 0.15, 1);
      g.rotateX(-Math.PI / 2);
      g.rotateY(i * 1.3);
      g.translate(p.x, yAt(p.x, p.z) + 0.02, p.z);
      return g.toNonIndexed();
    });
    // Sky-tinted so they read as standing water (a lighter sheet than the mud), glossy for the lights.
    const pm = new THREE.MeshStandardMaterial({ color: new THREE.Color(RAMPS.water[3]), roughness: 0.12, metalness: 0.25,
      emissive: new THREE.Color(RAMPS.night[3]), emissiveIntensity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new THREE.Mesh(mergeGeometries(geos.map(strip)), pm);
    m.receiveShadow = true;
    m.name = 'landmark-puddles';
    group.add(m);
  }

  scene.add(group);
  let tris = 0, draws = 0;
  group.traverse((o) => { if (o.isMesh) { draws++; tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  return { group, standTop, stats: { draws, tris: Math.round(tris), lights: 2 } };
}

/** Sign plate on a short post of its own, facing inward (ry). */
function signGeo(x, z, ry) {
  const g = rawBox(0.6, 0.4, 0.02, 0, 1.25, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
  g.translate(x, 0, z);
  return g;
}

/** Box whose every face shows the whole texture once (signs, the map board). */
function rawBox(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

/** Keep only position/normal/uv so differently-built geometries merge. */
function strip(g) {
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) out.setAttribute(k, g.attributes[k]);
  return out;
}

import * as THREE from 'three';
import { capsule, ellipsoid, subtract, surfaceNets, facetUV } from '../art/sdfMesh.js';
import { pixelMaterial, bigfootFur2Texture, bigfootFace2Texture, bigfootChestTexture, bigfootRibsTexture, skinTexture } from '../art/pixelTex.js';
import { createBigfootAnimator } from './bigfootAnim.js';
import { createBigfootBody } from './bigfootBody.js';

// Bigfoot, rebuilt from scratch (#58): one sculpted, low-poly skinned body.
//
// Instead of boxes bolted to joints, the whole creature is a single surface sculpted in code:
// body masses (pelvis, belly, barrel chest, a huge trapezius the head sinks into, pecs, delts,
// long arms, big hands, thick legs, broad feet) and long locks of hair are signed-distance
// shapes blended smoothly together, meshed into even quads and flat-shaded for a clean faceted
// low-poly look. Strong pixel textures do the rest: flowing clumped fur, bare tan hands and feet,
// and a hero face painted after the director's reference (old-silverback scowl, sunken eyes).
// The mesh is skinned to the same skeleton (bone names and rest offsets) the animator expects,
// so idle / walk / run / flee / investigate / stare / knock all deform it smoothly.
//
// Authored in rig units (about 2.6 tall) and scaled up to ~4 m.

const FWD = -1;                          // model forward is -Z
export const BIGFOOT_SCALE = 1.55;
const CELL = 0.036;                      // sculpt resolution: ~5.5 cm facets at full size - chunky low-poly planes, ~20k tris

// ---- skeleton (bind pose: everything upright, arms hanging) ---------------------------------
const RIG = [
  // name, parent, local offset
  ['hips', null, [0, 1.08, 0]],
  ['spine', 'hips', [0, 0.12, 0]],
  ['chest', 'spine', [0, 0.42, 0]],
  ['neck', 'chest', [0, 0.52, FWD * 0.14]],
  ['head', 'neck', [0, 0.0, FWD * 0.06]],
  ['jaw', 'head', [0, 0.02, FWD * 0.05]],
  ...['L', 'R'].flatMap((side) => {
    const s = side === 'L' ? -1 : 1;
    return [
      [`shoulder${side}`, 'chest', [s * 0.58, 0.44, 0.02]],
      [`upperArm${side}`, `shoulder${side}`, [0, 0, 0]],
      [`forearm${side}`, `upperArm${side}`, [0, -0.62, 0]],
      [`hand${side}`, `forearm${side}`, [0, -0.58, 0]],
      ...[0, 1, 2, 3].map((f) => [`finger${side}${f}`, `hand${side}`, [(f - 1.5) * 0.045 * s, -0.22, FWD * 0.02]]),
      [`thumb${side}`, `hand${side}`, [s * -0.07, -0.08, FWD * 0.05]],
      [`thigh${side}`, 'hips', [s * 0.22, -0.08, 0]],
      [`shin${side}`, `thigh${side}`, [0, -0.52, 0]],
      [`foot${side}`, `shin${side}`, [0, -0.46, 0]],
    ];
  }),
];

// World (rig-space) position of each joint in bind pose.
function jointPositions() {
  const pos = {};
  for (const [name, parent, o] of RIG) {
    const p = parent ? pos[parent] : [0, 0, 0];
    pos[name] = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  }
  return pos;
}

// Skinning segments: each bone influences the vertices near the segment it drives.
function boneSegments(J) {
  const seg = (a, b) => [J[a], typeof b === 'string' ? J[b] : b];
  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  const out = {
    hips: seg('hips', add(J.hips, [0, -0.06, 0])),
    spine: seg('spine', 'chest'),
    chest: [add(J.chest, [0, 0.05, 0]), add(J.chest, [0, 0.4, 0.05])],
    neck: seg('neck', add(J.neck, [0, 0.12, FWD * 0.06])),
    head: [add(J.head, [0, 0.12, 0]), add(J.head, [0, 0.3, FWD * 0.05])],
  };
  for (const side of ['L', 'R']) {
    out[`upperArm${side}`] = seg(`upperArm${side}`, `forearm${side}`);
    out[`forearm${side}`] = seg(`forearm${side}`, `hand${side}`);
    out[`hand${side}`] = [J[`hand${side}`], add(J[`hand${side}`], [0, -0.16, 0])];
    for (let f = 0; f < 4; f++) out[`finger${side}${f}`] = [J[`finger${side}${f}`], add(J[`finger${side}${f}`], [0, -0.15, FWD * 0.02])];
    out[`thumb${side}`] = [J[`thumb${side}`], add(J[`thumb${side}`], [0, -0.08, FWD * 0.04])];
    out[`thigh${side}`] = seg(`thigh${side}`, `shin${side}`);
    out[`shin${side}`] = seg(`shin${side}`, `foot${side}`);
    out[`foot${side}`] = [J[`foot${side}`], add(J[`foot${side}`], [0, 0, FWD * 0.3])];
  }
  return out;
}

// ---- the sculpt ------------------------------------------------------------------------------
// Each part: { f, box: [minx,miny,minz,maxx,maxy,maxz], k (blend radius) }. Parts whose bounding
// box is already further than the current distance can't change it, so they're skipped.
function part(kind, args, k) {
  const f = kind === 'cap' ? capsule(...args) : ellipsoid(...args);
  let box;
  if (kind === 'cap') {
    const [a, b, ra, rb = ra] = args, r = Math.max(ra, rb);
    box = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r];
  } else {
    const [c, rr] = args;
    box = [c[0] - rr[0], c[1] - rr[1], c[2] - rr[2], c[0] + rr[0], c[1] + rr[1], c[2] + rr[2]];
  }
  return { f, box, k, bone: TAG };
}
// The bone each sculpted shape belongs to (set while sculpting): skinning classifies every surface
// point by the shape it lies on, so a fingertip hanging by the thigh still belongs to the hand.
let TAG = 'chest';

function bodySDF() {
  const P = [];
  const E = (c, r, k = 0.09) => P.push(part('ell', [c, r], k));
  const C = (a, b, ra, rb, k = 0.07) => P.push(part('cap', [a, b, ra, rb], k));
  // Torso: pelvis, belly, barrel chest, the great trapezius hump, pecs.
  TAG = 'hips'; E([0, 1.08, 0.02], [0.34, 0.22, 0.25]);
  TAG = 'spine'; E([0, 1.36, -0.01], [0.33, 0.3, 0.29]);
  TAG = 'chest';
  E([0, 1.74, 0.05], [0.36, 0.36, 0.4]);                              // deep barrel chest; narrow enough to keep the armpits open                               // barrel chest, kept clear of the arms so they swing free
  E([0, 2.02, 0.12], [0.48, 0.24, 0.32], 0.12);                      // massive trapezius (muscular, #79)
  E([0, 1.86, 0.27], [0.36, 0.3, 0.2], 0.1);                           // back muscle mass / neck hump
  for (const s of [-1, 1]) E([s * 0.2, 1.79, -0.27], [0.21, 0.16, 0.12], 0.05);   // heavy pecs
  // Neck sunk into the shoulders; the head juts forward.
  TAG = 'neck'; C([0, 1.96, -0.02], [0, 2.16, -0.13], 0.17, 0.15, 0.1);
  TAG = 'head';
  E([0, 2.27, -0.2], [0.2, 0.22, 0.21], 0.06);                         // skull
  E([0, 2.47, -0.14], [0.065, 0.12, 0.19], 0.06);                      // tall sagittal crest (giant ape)
  C([-0.14, 2.35, -0.37], [0.14, 2.35, -0.37], 0.06, 0.06, 0.03);      // heavy brow shelf
  E([0, 2.19, -0.41], [0.12, 0.09, 0.1], 0.05);                        // muzzle pushed forward (gorilla profile)
  E([0, 2.245, -0.49], [0.05, 0.035, 0.03], 0.03);                     // broad flat nose on the muzzle
  E([0, 2.09, -0.35], [0.13, 0.075, 0.13], 0.05);                      // heavy undershot jaw
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    TAG = 'head';
    E([s * 0.15, 2.24, -0.34], [0.06, 0.06, 0.05], 0.03);              // cheekbones
    E([s * 0.215, 2.29, -0.17], [0.035, 0.065, 0.05], 0.02);           // ears, half hidden in the hair
    // Arms: delts, upper arm with a biceps swell, heavy forearm, big hands and fingers.
    TAG = `upperArm${S}`;                                             // shoulder caps ride the arm (parent chest fades in near the joint)
    E([s * 0.57, 1.98, 0.02], [0.24, 0.22, 0.23], 0.07);                // big deltoids
    C([s * 0.6, 2.0, 0], [s * 0.6, 1.44, 0], 0.155, 0.14, 0.03);        // upper arm: tight blend keeps the armpit open
    E([s * 0.62, 1.72, -0.08], [0.13, 0.19, 0.13], 0.03);              // biceps
    E([s * 0.64, 1.75, 0.08], [0.11, 0.2, 0.11], 0.03);                // triceps
    TAG = `forearm${S}`;
    C([s * 0.6, 1.44, 0], [s * 0.6, 0.9, -0.02], 0.145, 0.1);
    E([s * 0.62, 1.3, 0.0], [0.15, 0.19, 0.14], 0.04);                 // heavy forearm muscle
    TAG = `hand${S}`;
    E([s * 0.6, 0.78, -0.03], [0.085, 0.11, 0.055], 0.04);             // palm
    for (let f = 0; f < 4; f++) {
      const fx = s * 0.6 + (f - 1.5) * 0.045 * s;
      TAG = `finger${S}${f}`;
      C([fx, 0.68, -0.04], [fx, 0.5, -0.07], 0.026, 0.02, 0.012);
    }
    TAG = `thumb${S}`;
    C([s * 0.53, 0.8, -0.07], [s * 0.5, 0.68, -0.1], 0.025, 0.02, 0.015);   // thumb
    // Legs: thick thighs, calves, broad flat feet.
    TAG = `thigh${S}`;
    C([s * 0.22, 1.02, 0], [s * 0.23, 0.5, 0], 0.17, 0.135, 0.05);
    E([s * 0.27, 0.8, -0.07], [0.13, 0.21, 0.12], 0.04);               // quads bulge front/outside
    TAG = `shin${S}`;
    E([s * 0.24, 0.37, 0.06], [0.14, 0.18, 0.14], 0.04);               // heavy calf
    C([s * 0.23, 0.5, 0], [s * 0.23, 0.1, 0.02], 0.12, 0.09);
    TAG = `foot${S}`;
    E([s * 0.23, 0.05, -0.1], [0.11, 0.055, 0.25], 0.05);
    for (let t = 0; t < 4; t++) C([s * (0.18 + t * 0.03), 0.04, -0.3], [s * (0.18 + t * 0.03), 0.03, -0.36], 0.024, 0.02, 0.012);
  }
  // Long hair: tapered locks hanging from the crown, back and forearms, flaring out a
  // little at the tips. They're part of the same surface, so they read as sculpted fur.
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lock = (x, y, z, out, len, r0) => {
    const ox = x * out * 0.12, oz = z * out * 0.12;          // hang close: hair falls, it doesn't fan out
    P.push(part('cap', [[x, y, z], [x + ox, y - len, z + oz], r0, 0.012], 0.035));
  };
  TAG = 'neck';
  for (let i = 0; i < 10; i++) {                                         // mane: crown down the back
    const a = -1.2 + (i / 9) * 2.4;
    lock(Math.sin(a) * 0.2, 2.42, -0.17 + Math.cos(a) * 0.18, 0.5, 0.42 + rnd() * 0.2, 0.06);
  }
  for (const s of [-1, 1]) {
    TAG = `forearm${s < 0 ? 'L' : 'R'}`;
    for (let i = 0; i < 4; i++) lock(s * 0.68, 1.3 - i * 0.06, 0.06 + i * 0.01, 0.3, 0.14 + rnd() * 0.06, 0.04);            // forearm fringe
    TAG = `shin${s < 0 ? 'L' : 'R'}`;
    lock(s * 0.3, 0.32, 0.06, 0.5, 0.18, 0.05);                                                                              // ankles
  }
  TAG = 'chest';
  for (let i = 0; i < 5; i++) lock(-0.24 + i * 0.12, 1.98, 0.36, 0.4, 0.42 + rnd() * 0.12, 0.06);                          // back
  TAG = 'head';
  // (No sculpted chin beard: it rested on the chest and tore when he turned his head; the face texture paints it.)
  for (let i = 0; i < 3; i++) rnd();                                     // keep the hair layout's random sequence                          // beard
  const base = (x, y, z) => {
    let d = Infinity;
    for (const p of P) {
      const b = p.box;
      const dx = Math.max(b[0] - x, 0, x - b[3]), dy = Math.max(b[1] - y, 0, y - b[4]), dz = Math.max(b[2] - z, 0, z - b[5]);
      if (d !== Infinity && Math.hypot(dx, dy, dz) - p.k > d) continue;       // can't affect the blend
      const v = p.f(x, y, z);
      if (d === Infinity) d = v;
      else { const h = Math.max(p.k - Math.abs(d - v), 0) / p.k; d = Math.min(d, v) - h * h * p.k * 0.25; }
    }
    return d;
  };
  // Carve the eye sockets deep under the brow, and a bite torn out of the top of the left ear.
  const socket = (x, y, z) => Math.min(Math.hypot(x + 0.066, y - 2.3, z + 0.41) - 0.042, Math.hypot(x - 0.066, y - 2.3, z + 0.41) - 0.042,
    Math.hypot(x + 0.24, y - 2.345, z + 0.17) - 0.035);
  const carved = subtract(base, socket, 0.012);
  // Shaggy coat: a stretched noise (tight across, long down) pushes the fur surface out in hanging
  // ridges, so the coat reads as sculpted clumps. Face, hands and feet stay smooth.
  const sdf = (x, y, z) => {
    const d = carved(x, y, z);
    if (d > 0.06 || d < -0.06) return d;
    const face = y > 2.0 && z < -0.26 && Math.abs(x) < 0.2;
    const hand = y < 0.9 && Math.abs(x) > 0.44 && Math.abs(x) < 0.78;
    if (face || hand || y < 0.12) return d;
    const n = vnoise(x / 0.065, y / 0.24, z / 0.065) * 0.7 + vnoise(x / 0.13, y / 0.5, z / 0.13) * 0.3;
    return d - 0.036 * n;
  };
  sdf.parts = P;
  return sdf;
}

// Smooth value noise (0..1) for the coat.
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const fx = s(x - i), fy = s(y - j), fz = s(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(i, j, k), hash3(i + 1, j, k), fx), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), fx), fy),
    L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), fx), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), fx), fy), fz);
}

// ---- texturing regions ------------------------------------------------------------------------
const REGION = { FUR: 0, FUR_DARK: 1, SKIN: 2, FACE: 3, CHEST: 4, RIBS: 5 };
function regionOf(c, n) {
  if (c.y > 2.08 && c.y < 2.4 && Math.abs(c.x) < 0.13 && c.z < -0.33 && n.z < -0.35) return REGION.FACE;   // smaller bare face (director: giant ape)
  if ((c.y < 0.88 && Math.abs(c.x) > 0.45 && Math.abs(c.x) < 0.75) || c.y < 0.085) return REGION.SKIN;   // hands, feet
  if (c.y > 1.5 && c.y < 1.98 && Math.abs(c.x) < 0.38 && c.z < -0.12 && n.z < -0.45) return REGION.CHEST;  // claw-scarred chest
  if (c.y > 1.3 && c.y < 1.7 && c.x < -0.26 && Math.abs(c.z) < 0.24 && n.x < -0.5) return REGION.RIBS;   // torn coat, left flank
  if (c.y > 1.75 && (n.z > 0.25 || n.y > 0.6)) return REGION.FUR_DARK;                                   // back, shoulder tops
  return REGION.FUR;
}
// Fur UVs: strands always run down the body (v = height); u follows whichever side the facet faces.
// One projection per region for the face, chest scars and ribs so their painting stays whole.
const FUR_PPM = 2.4;
function bodyUV(g) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (const grp of g.groups) {
    for (let t = grp.start; t < grp.start + grp.count; t += 3) {
      let ax = 0, az = 0;
      { // facet normal
        const a = [pos.getX(t), pos.getY(t), pos.getZ(t)], b = [pos.getX(t + 1), pos.getY(t + 1), pos.getZ(t + 1)], c = [pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2)];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        ax = Math.abs(e1[1] * e2[2] - e1[2] * e2[1]); az = Math.abs(e1[0] * e2[1] - e1[1] * e2[0]);
      }
      for (let i = t; i < t + 3; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        switch (grp.materialIndex) {
          case REGION.FACE: uv.setXY(i, (x + 0.16) / 0.32, (y - 2.06) / 0.36); break;
          case REGION.CHEST: uv.setXY(i, (x + 0.4) / 0.8, (y - 1.5) / 0.5); break;
          case REGION.RIBS: uv.setXY(i, (z + 0.26) / 0.52, (y - 1.28) / 0.44); break;
          case REGION.SKIN: break;
          default: uv.setXY(i, (ax > az ? z : x) * FUR_PPM, y * FUR_PPM * 0.5);
        }
      }
    }
  }
  uv.needsUpdate = true;
}

let cachedGeometry = null;
function buildGeometry() {
  if (cachedGeometry) return cachedGeometry.clone();
  const sdf = bodySDF();
  const raw = surfaceNets(sdf, [-1.0, -0.02, -0.62], [1.0, 2.68, 0.62], CELL, { smooth: 1 });
  const g = facetUV(raw, 3, regionOf);             // skin: ~2 cm texels at size
  bodyUV(g);                                       // fur: ~2.6 cm texels; face, chest, ribs projected once
  skin(g, sdf.parts);
  cachedGeometry = g;
  return g.clone();
}

// Skin weights (#78 rework). The old nearest-segment weights let an arm drag the flank and one
// thigh drag the other, which showed as stretched webs. Now:
//  1. Each vertex belongs to the bone of the sculpted shape it lies on, and may only be moved by
//     that bone and the bones joined to it (parent and children).
//  2. Raw weights fall off smoothly with distance to each allowed bone segment.
//  3. Weights are then smoothed across the surface (neighbouring vertices average), so every
//     joint bends as a soft, organic fold instead of a crease, and re-masked to the part's bones.
// How thick the body is around each bone (rig units): distances are compared relative to this, so
// a flank point (near the arm's line but inside the torso's bulk) belongs to the torso.
const BONE_RADIUS = { hips: 0.32, spine: 0.38, chest: 0.45, neck: 0.18, head: 0.24, upperArm: 0.16, forearm: 0.12, hand: 0.09,
  finger: 0.03, thumb: 0.03, thigh: 0.18, shin: 0.12, foot: 0.1 };
const radiusOf = (name) => BONE_RADIUS[name.replace(/[LR]\d?$/, '')] ?? 0.15;
function skin(g, parts = null) {
  const J = jointPositions(), segs = boneSegments(J);
  const names = RIG.map((r) => r[0]);
  const nb = names.length;
  const list = Object.entries(segs).map(([name, [a, b]]) => ({ name, i: names.indexOf(name), r: radiusOf(name), a: new THREE.Vector3(...a), b: new THREE.Vector3(...b) }));
  const pos = g.attributes.position, n = pos.count;
  // Unique surface points (the mesh is non-indexed: corners repeat per triangle).
  const keyOf = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const uid = new Int32Array(n), ids = new Map();
  for (let i = 0; i < n; i++) { const k = keyOf(i); if (!ids.has(k)) ids.set(k, ids.size); uid[i] = ids.get(k); }
  const m = ids.size;
  const nbrs = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < n; t += 3) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) nbrs[uid[t + a]].add(uid[t + b]);
  const first = new Int32Array(m).fill(-1);
  for (let i = 0; i < n; i++) if (first[uid[i]] < 0) first[uid[i]] = i;
  // 1-2: part and raw weights per unique point.
  const W = new Float32Array(m * nb), part = new Array(m);
  const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  // Each point may follow the bone of the shape it lies on plus the bones joined to it (parent and
  // children), like a hand-weighted rig: a fingertip never picks up chest weight.
  const segNames = new Set(list.map((sg) => sg.name));
  const parentOf = Object.fromEntries(RIG.map(([n, par]) => [n, par]));
  const skinParent = (n) => { let q = parentOf[n]; while (q && !segNames.has(q)) q = parentOf[q]; return q; };
  // Parent weight only in the half of the bone next to the parent joint, children's only in the
  // half next to them: chest influence stops at mid upper arm, so the elbow has no chest seam (#79).
  const segByName = Object.fromEntries(list.map((sg) => [sg.name, sg]));
  const parentIdx = {}, childIdx = {};
  for (const n of segNames) {
    const par = skinParent(n);
    parentIdx[n] = par ? [names.indexOf(par)] : [];
    childIdx[n] = [...segNames].filter((c) => skinParent(c) === n).map((c) => names.indexOf(c));
  }
  const allowOf = new Array(m);
  // Allowed bones with a fade: the parent fades out along the bone (full at its joint, none at the
  // far end, where the next bone's points start), children fade in toward their joint.
  const allowFor = (owner, t) => {
    const fade = new Map([[names.indexOf(owner), 1]]);
    for (const i of parentIdx[owner]) fade.set(i, (1 - t) * (1 - t));
    for (const i of childIdx[owner]) fade.set(i, t * t);
    return fade;
  };
  for (let u = 0; u < m; u++) {
    p.fromBufferAttribute(pos, first[u]);
    let best = null, bestD = Infinity;
    const dist = list.map((sg) => {
      ab.subVectors(sg.b, sg.a); ap.subVectors(p, sg.a);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
      const d = ap.sub(ab.multiplyScalar(t)).length() / sg.r;       // in body-thicknesses
      if (d < bestD) { bestD = d; best = sg; }
      return d;
    });
    // Owner: the sculpted shape this point lies on (fallback: the nearest bone).
    let owner = best.name;
    if (parts) { let md = Infinity; for (const sh of parts) { const v = sh.f(p.x, p.y, p.z); if (v < md) { md = v; owner = sh.bone; } } }
    if (!segByName[owner]) owner = best.name;
    part[u] = owner;
    // Where along its own bone the point sits (0 at the parent joint, 1 at the far end).
    const os = segByName[owner];
    ab.subVectors(os.b, os.a); ap.subVectors(p, os.a);
    const tOwn = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    const allow = allowOf[u] = allowFor(owner, tOwn);
    list.forEach((sg, k) => { if (allow.has(sg.i)) W[u * nb + sg.i] = allow.get(sg.i) / Math.pow(dist[k] + 0.1, 6); });
    let tot = 0; for (let j = 0; j < nb; j++) tot += W[u * nb + j];
    for (let j = 0; j < nb; j++) W[u * nb + j] /= tot || 1;
  }
  // 3: smooth across the surface, re-masking to each point's part.
  const T = new Float32Array(m * nb);
  for (let it = 0; it < 14; it++) {
    for (let u = 0; u < m; u++) {
      const ns = nbrs[u], k = 1 / (ns.size + 1);
      for (let j = 0; j < nb; j++) {
        let acc = W[u * nb + j];
        for (const v of ns) acc += W[v * nb + j];
        T[u * nb + j] = acc * k;
      }
    }
    for (let u = 0; u < m; u++) {
      const allow = allowOf[u];
      let tot = 0;
      for (let j = 0; j < nb; j++) { const w = allow.has(j) ? T[u * nb + j] * Math.min(1, allow.get(j) * 4) : 0; W[u * nb + j] = w; tot += w; }
      for (let j = 0; j < nb; j++) W[u * nb + j] /= tot || 1;
    }
  }
  // Top 4 influences per corner.
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = uid[i];
    const top = [];
    for (let j = 0; j < nb; j++) { const w = W[u * nb + j]; if (w > 1e-4) top.push([j, w]); }
    top.sort((x, y) => y[1] - x[1]);
    const use = top.slice(0, 4), tot = use.reduce((a, x) => a + x[1], 0);
    use.forEach(([j, w], k) => { si[i * 4 + k] = j; sw[i * 4 + k] = w / tot; });
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // Organic shading (#78): smooth normals (area-weighted per surface point) instead of hard facets.
  const N = new Float32Array(m * 3), a3 = new THREE.Vector3(), b3 = new THREE.Vector3(), c3 = new THREE.Vector3(), f3 = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    a3.fromBufferAttribute(pos, t); b3.fromBufferAttribute(pos, t + 1); c3.fromBufferAttribute(pos, t + 2);
    f3.crossVectors(b3.sub(a3), c3.sub(a3));                       // length = 2 x area: area-weighted
    for (let k = 0; k < 3; k++) { const u = uid[t + k]; N[u * 3] += f3.x; N[u * 3 + 1] += f3.y; N[u * 3 + 2] += f3.z; }
  }
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = uid[i]; f3.set(N[u * 3], N[u * 3 + 1], N[u * 3 + 2]).normalize();
    nrm[i * 3] = f3.x; nrm[i * 3 + 1] = f3.y; nrm[i * 3 + 2] = f3.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
}

export function buildBigfootModel(profile) {
  const root = new THREE.Group();
  root.name = `cryptid-${profile.id}`;
  const body = new THREE.Group();
  body.name = 'bigfoot-body';
  body.scale.setScalar(BIGFOOT_SCALE);
  root.add(body);

  // Skeleton.
  const bones = {};
  const boneList = [];
  for (const [name, parent, o] of RIG) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...o);
    (parent ? bones[parent] : body).add(b);
    bones[name] = b;
    boneList.push(b);
  }

  // Skinned, flat-shaded, pixel-textured body.
  const fur = pixelMaterial(bigfootFur2Texture(0), { flatShading: false, roughness: 0.95 });
  const furDark = pixelMaterial(bigfootFur2Texture(1), { flatShading: false, roughness: 0.95 });
  const skinMat = pixelMaterial(skinTexture(), { flatShading: false, roughness: 0.8 });
  const faceTex = bigfootFace2Texture().clone();
  faceTex.wrapS = faceTex.wrapT = THREE.ClampToEdgeWrapping; faceTex.needsUpdate = true;
  const face = new THREE.MeshStandardMaterial({ map: faceTex, flatShading: false, roughness: 0.85 });
  const chest = pixelMaterial(bigfootChestTexture(), { flatShading: false, roughness: 0.95 });
  const ribs = pixelMaterial(bigfootRibsTexture(), { flatShading: false, roughness: 0.85 });
  const mesh = new THREE.SkinnedMesh(buildGeometry(), [fur, furDark, skinMat, face, chest, ribs]);
  mesh.name = 'bigfoot-skin';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;                       // skinned bounds move with the animation
  body.add(mesh);
  body.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));

  // Eyes: hot amber points deep in the sockets, with a soft additive glow, riding the head bone.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc35c });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const headJ = jointPositions().head;
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), eyeMat);
    e.position.set(s * 0.066, 2.3 - headJ[1], -0.385 - headJ[2]);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.032), glowMat);
    glow.position.set(s * 0.066, 2.3 - headJ[1], -0.4 - headJ[2]); glow.rotation.y = Math.PI;
    bones.head.add(e, glow);
  }
  // Fangs from the upper jaw: the left one long and yellowed, the right snapped off to a stump.
  const tooth = new THREE.MeshStandardMaterial({ color: 0xb8a77a, roughness: 0.5, flatShading: true });
  for (const [x, len] of [[-0.048, 0.06], [0.048, 0.022]]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.011, len, 4), tooth);
    f.position.set(x, 2.15 - len / 2 + 0.01 - headJ[1], -0.475 - headJ[2]); f.rotation.x = Math.PI;
    bones.head.add(f);
  }
  // Claws: curved dark horn on every finger and toe.
  const claw = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.4, flatShading: true });
  for (const side of ['L', 'R']) {
    for (let f = 0; f < 4; f++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.15, 5), claw);   // long, hooked
      c.position.set(0, -0.21, FWD * 0.06); c.rotation.x = Math.PI + 0.5;
      bones[`finger${side}${f}`].add(c);
    }
    for (let t = 0; t < 4; t++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.07, 5), claw);
      c.position.set((side === 'L' ? -1 : 1) * (t * 0.03 - 0.05), 0.03, FWD * 0.39); c.rotation.x = -Math.PI / 2 - 0.25;
      bones[`foot${side}`].add(c);
    }
  }

  // An invisible proxy keeps the AI's state tinting (debug readout) off the textured body.
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
  root.add(proxy);
  root.userData.body = proxy;

  // ---- Procedural animation (#43): see bigfootAnim.js -----------------------------------
  const animator = createBigfootAnimator(root, bones, { worldScale: BIGFOOT_SCALE });
  root.userData.animator = animator;
  // Procedural body on top of the clips (#78): planted feet + leg IK, weight transfer, inertia,
  // and targeting spread down the spine (see bigfootBody.js). root.userData.look = { target, weight }.
  const proc = createBigfootBody(root, body, bones, animator, { worldScale: BIGFOOT_SCALE });
  root.userData.body3 = proc;
  root.userData.animate = (dt, speed = 0, state = 'roam') => { animator.animate(dt, speed, state); proc.update(dt, speed, state); };
  root.userData.play = (name, opts) => animator.play(name, opts);
  root.userData.knockTiming = animator.knockTiming;
  Object.defineProperty(root.userData, 'action', { get: () => animator.action });
  Object.defineProperty(root.userData, 'clip', { get: () => animator.clip });
  root.userData.bones = bones;
  return root;
}

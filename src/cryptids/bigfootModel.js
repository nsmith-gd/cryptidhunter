import * as THREE from 'three';
import { capsule, ellipsoid, subtract, surfaceNets, facetUV } from '../art/sdfMesh.js';
import { pixelMaterial, bigfootFur2Texture, bigfootFace2Texture, bigfootChestTexture, bigfootRibsTexture, skinTexture } from '../art/pixelTex.js';
import { createBigfootAnimator } from './bigfootAnim.js';

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
  return { f, box, k };
}

function bodySDF() {
  const P = [];
  const E = (c, r, k = 0.09) => P.push(part('ell', [c, r], k));
  const C = (a, b, ra, rb, k = 0.07) => P.push(part('cap', [a, b, ra, rb], k));
  // Torso: pelvis, belly, barrel chest, the great trapezius hump, pecs.
  E([0, 1.08, 0.02], [0.34, 0.22, 0.25]);
  E([0, 1.36, -0.01], [0.33, 0.3, 0.29]);
  E([0, 1.74, 0.03], [0.4, 0.34, 0.34]);                               // barrel chest, kept clear of the arms so they swing free
  E([0, 2.0, 0.12], [0.44, 0.2, 0.3], 0.12);
  E([0, 1.86, 0.26], [0.34, 0.26, 0.16], 0.1);                         // back muscle mass
  for (const s of [-1, 1]) E([s * 0.2, 1.78, -0.25], [0.19, 0.14, 0.09], 0.06);
  // Neck sunk into the shoulders; the head juts forward.
  C([0, 1.96, -0.02], [0, 2.16, -0.13], 0.17, 0.15, 0.1);
  E([0, 2.27, -0.2], [0.2, 0.22, 0.21], 0.06);                         // skull
  E([0, 2.44, -0.15], [0.07, 0.09, 0.17], 0.06);                       // sagittal crest
  C([-0.15, 2.36, -0.36], [0.15, 2.36, -0.36], 0.05, 0.05, 0.03);      // brow ridge
  E([0, 2.18, -0.36], [0.13, 0.1, 0.09], 0.05);                        // muzzle
  E([0, 2.08, -0.3], [0.14, 0.07, 0.11], 0.05);                        // heavy jaw
  for (const s of [-1, 1]) {
    E([s * 0.15, 2.24, -0.34], [0.06, 0.06, 0.05], 0.03);              // cheekbones
    E([s * 0.215, 2.29, -0.17], [0.035, 0.065, 0.05], 0.02);           // ears, half hidden in the hair
    // Arms: delts, upper arm with a biceps swell, heavy forearm, big hands and fingers.
    E([s * 0.56, 1.98, 0.02], [0.21, 0.2, 0.21], 0.08);
    C([s * 0.58, 2.02, 0], [s * 0.6, 1.44, 0], 0.17, 0.13);
    E([s * 0.6, 1.72, -0.07], [0.12, 0.17, 0.11], 0.05);
    C([s * 0.6, 1.44, 0], [s * 0.6, 0.9, -0.02], 0.135, 0.09);
    E([s * 0.6, 1.3, 0.0], [0.13, 0.17, 0.12], 0.05);                  // forearm muscle
    E([s * 0.6, 0.78, -0.03], [0.085, 0.11, 0.055], 0.04);             // palm
    for (let f = 0; f < 4; f++) {
      const fx = s * 0.6 + (f - 1.5) * 0.045 * s;
      C([fx, 0.68, -0.04], [fx, 0.5, -0.07], 0.026, 0.02, 0.012);
    }
    C([s * 0.53, 0.8, -0.07], [s * 0.5, 0.68, -0.1], 0.025, 0.02, 0.015);   // thumb
    // Legs: thick thighs, calves, broad flat feet.
    C([s * 0.22, 1.02, 0], [s * 0.23, 0.5, 0], 0.165, 0.13, 0.05);
    E([s * 0.23, 0.36, 0.05], [0.13, 0.16, 0.12], 0.05);
    C([s * 0.23, 0.5, 0], [s * 0.23, 0.1, 0.02], 0.12, 0.09);
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
  for (let i = 0; i < 10; i++) {                                         // mane: crown down the back
    const a = -1.2 + (i / 9) * 2.4;
    lock(Math.sin(a) * 0.2, 2.42, -0.17 + Math.cos(a) * 0.18, 0.5, 0.42 + rnd() * 0.2, 0.06);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) lock(s * 0.68, 1.3 - i * 0.06, 0.06 + i * 0.01, 0.3, 0.14 + rnd() * 0.06, 0.04);            // forearm fringe
    lock(s * 0.3, 0.32, 0.06, 0.5, 0.18, 0.05);                                                                              // ankles
  }
  for (let i = 0; i < 5; i++) lock(-0.24 + i * 0.12, 1.98, 0.36, 0.4, 0.42 + rnd() * 0.12, 0.06);                          // back
  for (let i = 0; i < 3; i++) lock(-0.07 + i * 0.07, 2.05, -0.33, 0.2, 0.2 + rnd() * 0.06, 0.04);                          // beard
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
  return (x, y, z) => {
    const d = carved(x, y, z);
    if (d > 0.06 || d < -0.06) return d;
    const face = y > 2.0 && z < -0.26 && Math.abs(x) < 0.2;
    const hand = y < 0.9 && Math.abs(x) > 0.44 && Math.abs(x) < 0.78;
    if (face || hand || y < 0.12) return d;
    const n = vnoise(x / 0.065, y / 0.24, z / 0.065) * 0.7 + vnoise(x / 0.13, y / 0.5, z / 0.13) * 0.3;
    return d - 0.036 * n;
  };
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
  if (c.y > 2.06 && c.y < 2.44 && Math.abs(c.x) < 0.17 && c.z < -0.3 && n.z < -0.3) return REGION.FACE;
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
          case REGION.FACE: uv.setXY(i, (x + 0.2) / 0.4, (y - 2.04) / 0.42); break;
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
  skin(g);
  cachedGeometry = g;
  return g.clone();
}

// Skin weights: each vertex follows its nearest bone segments (top 3, inverse-distance falloff).
function skin(g) {
  const J = jointPositions(), segs = boneSegments(J);
  const names = RIG.map((r) => r[0]);
  const list = Object.entries(segs).map(([name, [a, b]]) => ({ i: names.indexOf(name), a: new THREE.Vector3(...a), b: new THREE.Vector3(...b) }));
  const pos = g.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v);
    const scored = list.map((s) => {
      ab.subVectors(s.b, s.a); ap.subVectors(p, s.a);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
      const d = ap.sub(ab.multiplyScalar(t)).length();
      return { i: s.i, w: 1 / Math.pow(d + 0.02, 6) };   // sharp falloff: limbs don't drag the body
    }).sort((x, y) => y.w - x.w).slice(0, 3);
    const tot = scored.reduce((a, s) => a + s.w, 0);
    scored.forEach((s, k) => { si[v * 4 + k] = s.i; sw[v * 4 + k] = s.w / tot; });
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
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
  const fur = pixelMaterial(bigfootFur2Texture(0), { flatShading: true, roughness: 0.95 });
  const furDark = pixelMaterial(bigfootFur2Texture(1), { flatShading: true, roughness: 0.95 });
  const skinMat = pixelMaterial(skinTexture(), { flatShading: true, roughness: 0.8 });
  const faceTex = bigfootFace2Texture().clone();
  faceTex.wrapS = faceTex.wrapT = THREE.ClampToEdgeWrapping; faceTex.needsUpdate = true;
  const face = new THREE.MeshStandardMaterial({ map: faceTex, flatShading: true, roughness: 0.85 });
  const chest = pixelMaterial(bigfootChestTexture(), { flatShading: true, roughness: 0.95 });
  const ribs = pixelMaterial(bigfootRibsTexture(), { flatShading: true, roughness: 0.85 });
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
    f.position.set(x, 2.15 - len / 2 + 0.01 - headJ[1], -0.425 - headJ[2]); f.rotation.x = Math.PI;
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
  root.userData.animate = (dt, speed = 0, state = 'roam') => animator.animate(dt, speed, state);
  root.userData.play = (name, opts) => animator.play(name, opts);
  root.userData.knockTiming = animator.knockTiming;
  Object.defineProperty(root.userData, 'action', { get: () => animator.action });
  Object.defineProperty(root.userData, 'clip', { get: () => animator.clip });
  root.userData.bones = bones;
  return root;
}

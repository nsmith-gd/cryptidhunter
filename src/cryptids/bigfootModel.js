import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  pixelMaterial, furTexture, skinTexture, furFringeTexture, bigfootScowlTexture, longHairTexture, ribScarTexture,
} from '../art/pixelTex.js';

// Bigfoot (final, #42): a big, hunched, menacing low-poly body (~3.4 m tall standing, shoulders
// wider than a doorway) in hand-painted pixel textures, with a shaggy silhouette made of hanging
// fur cards, clawed hands and feet, a snarling face with sunken eyeshine, and procedural idle /
// walk / run on a simple bone hierarchy. Faces -Z, feet at the origin.
//
//   root ─ body (scaled) ─ hips ─ spine ─ chest ─ neck ─ head ─ jaw
//                                       └ shoulderL/R ─ upperArm ─ forearm ─ hand ─ fingers
//                          hips ─ thighL/R ─ shin ─ foot ─ toes

const FWD = -1;          // model forward is -Z
export const BIGFOOT_SCALE = 1.55;   // the rig below is authored at ~2.6 m; scaled up to ~4 m

// Box with its top face scaled (taper), pivot at the top so limbs hang from their joint.
function limbGeo(w, h, d, { taper = 1, taperD = taper, pivot = 'top', ppm = 4 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;           // 0 bottom .. 1 top
    const sx = THREE.MathUtils.lerp(taper, 1, t), sz = THREE.MathUtils.lerp(taperD, 1, t);
    pos.setX(i, pos.getX(i) * sx); pos.setZ(i, pos.getZ(i) * sz);
  }
  g.translate(0, pivot === 'top' ? -h / 2 : pivot === 'bottom' ? h / 2 : 0, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * ppm, uv.getY(i) * h * ppm * 0.5);
  g.computeVertexNormals();
  return g;
}

// Hanging fur card: a plane whose top edge sits at the attach point, strands hanging down.
const fringeGeoCache = new Map();
function fringeGeo(w, h) {
  const key = `${w}|${h}`;
  if (!fringeGeoCache.has(key)) {
    // Crossed pair (radial + tangent) so the shag breaks the silhouette from every angle.
    const a = new THREE.PlaneGeometry(w, h); a.translate(0, -h / 2, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    fringeGeoCache.set(key, mergeGeometries([a, b]));
  }
  return fringeGeoCache.get(key);
}

export function buildBigfootModel(profile) {
  const fur = pixelMaterial(furTexture(0), { flatShading: true });
  const furDark = pixelMaterial(furTexture(1), { flatShading: true });
  const skin = pixelMaterial(skinTexture(), { flatShading: true });
  const face = pixelMaterial(bigfootScowlTexture(), { flatShading: true });
  const fringe = [0, 1].map((v) => pixelMaterial(furFringeTexture(v), { side: THREE.DoubleSide }));
  fringe.push(pixelMaterial(longHairTexture(), { side: THREE.DoubleSide }));   // variant 2: long mane
  const claw = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 0.5, flatShading: true });
  const ribScar = pixelMaterial(ribScarTexture(), { side: THREE.DoubleSide, flatShading: true });
  const twig = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, flatShading: true });
  const burr = new THREE.MeshStandardMaterial({ color: 0x5a4a22, roughness: 1, flatShading: true });
  const deadLeaf = new THREE.MeshStandardMaterial({ color: 0x7a3e24, roughness: 1, side: THREE.DoubleSide });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xb8a878, roughness: 0.4, flatShading: true });
  const mouth = new THREE.MeshBasicMaterial({ color: 0x0b0708 });
  // Eyeshine: two hot amber points that catch your torch from the dark.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  // Glow halo around each eye: additive, so the eyes burn out of the dark at any distance.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  const root = new THREE.Group();
  root.name = `cryptid-${profile.id}`;
  const body = new THREE.Group();
  body.name = 'bigfoot-body';
  body.scale.setScalar(BIGFOOT_SCALE);
  root.add(body);
  const bones = {};
  const part = (name, parent, geo, mat, x, y, z, { shadow = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    m.name = name;
    parent.add(m);
    bones[name] = m;
    return m;
  };
  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); bones[name] = g; return g;
  };
  let nFringe = 0;
  // Shag: hanging fur cards around a bone, facing outward at the given angles (radians around Y).
  const shag = (parent, y, radius, angles, w, h, { variant = 0, tilt = 0.25, jitter = 0.15 } = {}) => {
    for (const a of angles) {
      const m = new THREE.Mesh(fringeGeo(w * 1.25, h * 1.15 * (1 - jitter / 2 + Math.round(Math.random() * 3) / 3 * jitter)), fringe[variant]);
      m.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
      m.rotation.set(0, a, 0);
      m.rotateX(tilt);               // splay outward a little
      m.castShadow = true;
      m.name = `fur-${nFringe++}`;
      parent.add(m);
    }
  };
  const ring = (n, from = 0, to = Math.PI * 2) => Array.from({ length: n }, (_, i) => from + (to - from) * (i + 0.5) / n);

  // ---- Torso: massive, hunched, with a muscle hump behind the neck ----------------------
  const hips = joint('hips', body, 0, 1.08, 0);
  part('pelvis', hips, limbGeo(0.66, 0.34, 0.46, { taper: 1.05, pivot: 'center' }), fur, 0, 0, 0);
  shag(hips, -0.1, 0.36, ring(10), 0.24, 0.36, { tilt: 0.2 });                       // hip skirt of fur
  const spine = joint('spine', hips, 0, 0.12, 0);
  part('belly', spine, limbGeo(0.7, 0.44, 0.5, { taper: 0.95, pivot: 'bottom' }), fur, 0, 0, 0);
  const chest = joint('chest', spine, 0, 0.42, 0);
  part('ribcage', chest, limbGeo(1.02, 0.56, 0.62, { taper: 0.7, taperD: 0.82, pivot: 'bottom' }), furDark, 0, 0, 0.02);
  for (const s of [-1, 1]) part(`pec${s}`, chest, limbGeo(0.36, 0.26, 0.12, { taper: 0.85, pivot: 'center' }), fur, s * 0.2, 0.34, FWD * 0.29);
  // Worn bare patches: ribs and sinew showing through, raked with old claw scars (left flank, right chest).
  part('ribsL', chest, new THREE.PlaneGeometry(0.34, 0.34), ribScar, -0.45, 0.22, FWD * 0.1).rotation.set(0, -Math.PI / 2 - 0.35, 0);
  part('scarChest', chest, new THREE.PlaneGeometry(0.24, 0.24), ribScar, 0.17, 0.36, FWD * 0.352).rotation.set(0, Math.PI, 0.3);
  part('hump', chest, limbGeo(0.98, 0.38, 0.48, { taper: 1.35, pivot: 'bottom' }), furDark, 0, 0.44, 0.12);   // massive trapezius
  for (const s of [-1, 1]) part(`trap${s}`, chest, limbGeo(0.3, 0.3, 0.36, { taper: 0.6, pivot: 'bottom' }), furDark, s * 0.32, 0.6, 0.06);   // the head sinks between them
  shag(chest, 0.74, 0.34, ring(7, -Math.PI * 0.45, Math.PI * 0.45), 0.3, 0.55, { variant: 1, tilt: 0.45 });     // mane down the back
  shag(chest, 0.44, 0.36, ring(6, -Math.PI * 0.4, Math.PI * 0.4), 0.32, 0.5, { variant: 1, tilt: 0.3 });
  shag(chest, 0.5, 0.33, ring(4, Math.PI * 0.8, Math.PI * 1.2), 0.24, 0.36, { tilt: 0.15 });   // chest hair
  shag(chest, 0.4, 0.34, ring(5, Math.PI * 0.72, Math.PI * 1.28), 0.26, 0.6, { variant: 2, tilt: 0.12 });   // long hair hanging over the chest
  shag(chest, 0.5, 0.53, [Math.PI / 2, -Math.PI / 2, Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5], 0.32, 0.5, { tilt: 0.3 });                              // flanks
  shag(spine, 0.38, 0.38, [Math.PI / 2, -Math.PI / 2, Math.PI * 0.25, -Math.PI * 0.25, 0], 0.3, 0.44, { tilt: 0.2 });

  // ---- Head: low-slung, crested, snarling ------------------------------------------------
  const neck = joint('neck', chest, 0, 0.52, FWD * 0.14);
  const headGeo = limbGeo(0.4, 0.4, 0.4, { taper: 1.15, pivot: 'bottom', ppm: 3 });
  const head = new THREE.Mesh(headGeo, [fur, fur, furDark, fur, furDark, face]);   // +x -x +y -y +z -z
  head.position.set(0, -0.04, FWD * 0.1); head.castShadow = true; head.name = 'head';
  neck.add(head); bones.head = head;
  const uv = headGeo.attributes.uv, hp = headGeo.attributes.position, faceGroup = headGeo.groups[5];
  for (let i = faceGroup.start; i < faceGroup.start + faceGroup.count; i++) {
    const vi = headGeo.index.getX(i);
    uv.setXY(vi, 0.5 - hp.getX(vi) / 0.44, hp.getY(vi) / 0.4);
  }
  part('crest', head, limbGeo(0.14, 0.16, 0.36, { taper: 2.4, pivot: 'bottom' }), furDark, 0, 0.38, 0.04);   // sagittal crest
  part('brow', head, limbGeo(0.44, 0.09, 0.12, { pivot: 'center' }), furDark, 0, 0.28, FWD * 0.2);         // heavy brow shelf
  part('cheekL', head, limbGeo(0.06, 0.16, 0.08, { pivot: 'center' }), furDark, -0.22, 0.15, FWD * 0.17);
  part('cheekR', head, limbGeo(0.06, 0.16, 0.08, { pivot: 'center' }), furDark, 0.22, 0.15, FWD * 0.17);
  // Ears: small, leathery, set back; the left one torn ragged (a chunk missing from the top).
  part('earR', head, limbGeo(0.04, 0.11, 0.08, { taper: 0.7, pivot: 'bottom', ppm: 2 }), skin, 0.235, 0.2, FWD * 0.02).rotation.z = -0.3;
  part('earL', head, limbGeo(0.04, 0.06, 0.08, { taper: 1.3, pivot: 'bottom', ppm: 2 }), skin, -0.235, 0.2, FWD * 0.02).rotation.z = 0.25;
  for (const x of [-0.085, 0.085]) {
    part(`eye${x}`, head, new THREE.BoxGeometry(0.05, 0.028, 0.01), eyeMat, x, 0.215, FWD * 0.212, { shadow: false });
    part(`eyeGlow${x}`, head, new THREE.PlaneGeometry(0.085, 0.06), glowMat, x, 0.215, FWD * 0.22, { shadow: false }).rotation.y = Math.PI;
  }
  // Chin: the scowl, nose, mouth and fangs are painted into the face texture (reads at pixel scale).
  const jaw = joint('jaw', head, 0, 0.02, FWD * 0.05);   // heavy chin under the painted face (nose, mouth, fangs are in the texture)
  part('jawMesh', jaw, limbGeo(0.38, 0.12, 0.28, { taper: 0.8, pivot: 'top', ppm: 2 }), fur, 0, 0, 0);   // wide, heavy jaw
  shag(head, 0.4, 0.24, ring(8, -Math.PI * 0.55, Math.PI * 0.55), 0.2, 0.4, { variant: 1, tilt: 0.4 });   // mane framing the face
  // Long hair pouring from the crown over the shoulders and down the back.
  shag(head, 0.44, 0.2, ring(7, -Math.PI * 0.5, Math.PI * 0.5), 0.26, 0.95, { variant: 2, tilt: 0.35 });
  shag(head, 0.3, 0.24, [Math.PI / 2, -Math.PI / 2, Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4], 0.16, 0.8, { variant: 2, tilt: 0.25 });
  shag(head, 0.2, 0.25, [Math.PI / 2 + 0.35, -Math.PI / 2 - 0.35], 0.18, 0.32, { tilt: 0.15 });              // side whiskers
  shag(jaw, -0.1, 0.15, ring(3, Math.PI * 0.75, Math.PI * 1.25), 0.14, 0.26, { variant: 2, tilt: 0.05 });  // beard

  // ---- Arms: long enough to hang past the knees, huge clawed hands -----------------------
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const sh = joint(`shoulder${side}`, chest, s * 0.58, 0.44, 0.02);
    part(`delt${side}`, sh, limbGeo(0.38, 0.32, 0.36, { taper: 0.8, pivot: 'top' }), furDark, 0, 0.12, 0);
    shag(sh, 0.14, 0.22, ring(5, s * Math.PI / 2 - 1.3, s * Math.PI / 2 + 1.3), 0.26, 0.46, { variant: 1, tilt: 0.35 });
    shag(sh, 0.2, 0.25, ring(3, s * Math.PI / 2 - 0.8, s * Math.PI / 2 + 0.8), 0.28, 0.85, { variant: 2, tilt: 0.3 });   // long shoulder hair
    const upper = joint(`upperArm${side}`, sh, 0, 0, 0);
    part(`upperArmMesh${side}`, upper, limbGeo(0.26, 0.64, 0.28, { taper: 0.78 }), fur, 0, 0, 0);
    shag(upper, -0.08, 0.16, ring(4, -Math.PI * 0.4, Math.PI * 0.4).concat([s * Math.PI / 2]), 0.22, 0.5, { tilt: 0.2 });
    const fore = joint(`forearm${side}`, upper, 0, -0.62, 0);
    part(`forearmMesh${side}`, fore, limbGeo(0.24, 0.6, 0.25, { taper: 0.7 }), fur, 0, 0, 0);
    shag(fore, -0.05, 0.15, ring(4, -Math.PI * 0.45, Math.PI * 0.45).concat([s * Math.PI / 2]), 0.22, 0.55, { tilt: 0.15 });  // long forearm fringe
    const hand = joint(`hand${side}`, fore, 0, -0.58, 0);
    part(`handMesh${side}`, hand, limbGeo(0.18, 0.24, 0.12, { taper: 0.85, ppm: 2 }), skin, 0, 0, FWD * 0.01);
    // Four long curled fingers ending in claws, plus a thumb.
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.042;
      const finger = joint(`finger${side}${f}`, hand, fx, -0.22, FWD * 0.02);
      part(`fingerMesh${side}${f}`, finger, limbGeo(0.035, 0.14, 0.04, { taper: 0.7, ppm: 2 }), skin, 0, 0, 0);
      const c = part(`claw${side}${f}`, finger, new THREE.ConeGeometry(0.017, 0.17, 4), claw, 0, -0.2, FWD * 0.01, { shadow: false });
      c.rotation.x = Math.PI + 0.5;
      finger.rotation.x = 0.35;     // curled forward
    }
    const thumb = joint(`thumb${side}`, hand, s * -0.08, -0.08, FWD * 0.05);
    part(`thumbMesh${side}`, thumb, limbGeo(0.035, 0.1, 0.04, { taper: 0.7, ppm: 2 }), skin, 0, 0, 0);
    thumb.rotation.set(0.6, 0, s * -0.4);
  }
  // ---- Legs: thick, bowed, shaggy; huge clawed feet --------------------------------------
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const thigh = joint(`thigh${side}`, hips, s * 0.22, -0.08, 0);
    part(`thighMesh${side}`, thigh, limbGeo(0.32, 0.54, 0.34, { taper: 0.72 }), fur, 0, 0, 0);
    shag(thigh, -0.1, 0.19, ring(5, s * Math.PI / 2 - 1.4, s * Math.PI / 2 + 1.4), 0.24, 0.44, { tilt: 0.2 });
    const shin = joint(`shin${side}`, thigh, 0, -0.52, 0);
    part(`shinMesh${side}`, shin, limbGeo(0.24, 0.48, 0.26, { taper: 0.78 }), fur, 0, 0, 0);
    shag(shin, -0.16, 0.15, ring(6), 0.18, 0.32, { tilt: 0.3 });                                  // shaggy ankles
    const foot = joint(`foot${side}`, shin, 0, -0.46, 0);
    part(`footMesh${side}`, foot, limbGeo(0.22, 0.1, 0.46, { taper: 1, pivot: 'top', ppm: 2 }), skin, 0, 0, FWD * 0.12);
    for (let t = 0; t < 4; t++) {
      const c = part(`toeClaw${side}${t}`, foot, new THREE.ConeGeometry(0.022, 0.14, 4), claw, (t - 1.5) * 0.05, -0.08, FWD * 0.4, { shadow: false });
      c.rotation.x = -Math.PI / 2 - 0.3;
    }
  }

  // Debris matted into the fur: twigs, burrs and dead leaves on the shoulders, back and mane.
  const stuck = [[bones.chest, 0.3, 0.66, 0.2], [bones.chest, -0.36, 0.6, 0.24], [bones.chest, 0.05, 0.7, 0.32],
    [bones.chest, -0.15, 0.45, 0.34], [bones.head, 0.12, 0.42, 0.15], [bones.head, -0.16, 0.36, 0.12],
    [bones.shoulderL, 0, 0.22, 0.1], [bones.shoulderR, 0, 0.2, -0.05], [bones.spine, 0.25, 0.3, 0.3]];
  stuck.forEach(([parent, x, y, z], i) => {
    const t = part(`twig${i}`, parent, new THREE.BoxGeometry(0.02, 0.02, 0.22 + (i % 3) * 0.08), twig, x, y, z, { shadow: false });
    t.rotation.set(0.6 * ((i % 2) * 2 - 1), i * 1.3, 0.4);
    part(`burr${i}`, parent, new THREE.IcosahedronGeometry(0.025, 0), burr, x + 0.04, y - 0.05, z + 0.02, { shadow: false });
    if (i % 2 === 0) part(`leaf${i}`, parent, new THREE.PlaneGeometry(0.07, 0.05), deadLeaf, x - 0.05, y + 0.02, z + 0.03, { shadow: false }).rotation.set(0.4, i, 0.7);
  });

  // An invisible proxy keeps the AI's state tinting (debug readout) off the textured body.
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
  root.add(proxy);
  root.userData.body = proxy;

  // ---- Procedural animation (#43) -------------------------------------------------------
  // Locomotion layer (blended by real speed): idle -> walk -> run.
  // State layer (blended by AI state):      flee (deep lean, looks back over its shoulder),
  //                                          investigate (low, slow, head scanning and sniffing),
  //                                          stare (observe / aggress: straightens, locks on).
  // Action layer (one-shots on top):         knock (rears back and clubs a trunk, N strikes).
  // Every cycle is driven by a phase or clock, so walk/run/idle loop seamlessly.
  let phase = 0, idleT = Math.random() * 10, runBlend = 0, moveBlend = 0, fleeW = 0, invW = 0, stareW = 0;
  let action = null;                    // { name, t, count }
  const STRIDE = 1.5 * BIGFOOT_SCALE;   // world metres per step pair, matched to the bigger body
  const KNOCK = { windup: 0.38, gap: 0.62, recover: 0.45 };
  const ease = (x) => x * x * (3 - 2 * x);
  const lerp = THREE.MathUtils.lerp;
  /** Start a one-shot action. knock: { count } strikes; the first lands ~KNOCK.windup s in. */
  root.userData.play = (name, opts = {}) => { action = { name, t: 0, count: opts.count ?? 2 }; };
  root.userData.knockTiming = KNOCK;
  Object.defineProperty(root.userData, 'action', { get: () => action?.name ?? null });
  root.userData.animate = (dt, speed = 0, state = 'roam') => {
    idleT += dt;
    const k = Math.min(1, dt * 4);
    const moving = THREE.MathUtils.clamp(speed / 0.6, 0, 1);
    moveBlend += (moving - moveBlend) * Math.min(1, dt * 6);
    const run = THREE.MathUtils.clamp((speed - 2.6) / 2.5, 0, 1);
    runBlend += (run - runBlend) * k;
    fleeW += ((state === 'flee' ? 1 : 0) - fleeW) * k;
    invW += ((state === 'investigate' ? 1 : 0) - invW) * k;
    stareW += ((state === 'observe' || state === 'aggress' || state === 'warn' ? 1 : 0) - stareW) * k;   // warn: rears up and stares
    const stride = lerp(STRIDE, STRIDE * 1.9, runBlend) * (1 - 0.25 * invW);   // short, careful steps when investigating
    phase += (speed / stride) * Math.PI * dt;
    const sw = Math.sin(phase), cw = Math.cos(phase);
    const mb = moveBlend, rb = runBlend;

    // ---- body ----
    const lean = 0.32 + 0.35 * rb + 0.15 * fleeW + 0.14 * invW - 0.12 * stareW;
    const breath = Math.sin(idleT * (1.4 + rb * 1.6));
    bones.hips.position.y = 1.08 - mb * (0.04 + 0.05 * rb) - 0.07 * invW + Math.abs(cw) * mb * (0.05 + 0.08 * rb) + (1 - mb) * breath * 0.01;
    bones.hips.rotation.set(0, sw * 0.12 * mb, cw * 0.05 * mb * (1 - rb));
    bones.spine.rotation.set(-lean * 0.55, -sw * 0.1 * mb, 0);
    bones.chest.rotation.set(-(lean * 0.45 + (1 - mb) * breath * 0.035), -sw * 0.12 * mb, 0);
    // ---- head ----
    // idle: slow scan; investigate: quick scans + sniffing; flee: glances back over the shoulder; stare: locked on.
    const idleLook = (1 - mb) * Math.sin(idleT * 0.4) * 0.6;
    const scan = Math.sin(idleT * 1.15) * 0.8 + Math.sin(idleT * 2.9) * 0.15;
    const glance = Math.pow(Math.max(0, Math.sin(idleT * 0.85)), 6) * 1.15;
    const yaw = lerp(lerp(lerp(idleLook, scan, invW), glance, fleeW), 0, stareW);
    const sniff = Math.sin(idleT * 6.5) * 0.05 * invW;
    bones.neck.rotation.set(lean * 0.95 - 0.12 + sniff - 0.1 * invW, yaw, 0);
    bones.jaw.rotation.x = 0.12 + breath * 0.04 + rb * 0.25 + 0.2 * stareW;
    // ---- legs ----
    const legAmp = lerp(0.45, 0.85, rb) * mb;
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = sw * s;
      bones[`thigh${side}`].rotation.set(a * legAmp + 0.12 + 0.12 * mb + 0.12 * invW, 0, s * -0.04);
      const bendPhase = Math.max(0, Math.sin(phase + (s > 0 ? 0 : Math.PI) - Math.PI / 2 + 0.4));
      bones[`shin${side}`].rotation.set(-(0.22 + 0.15 * invW + bendPhase * lerp(0.7, 1.4, rb) * mb), 0, 0);
      bones[`foot${side}`].rotation.set(-(bones[`thigh${side}`].rotation.x + bones[`shin${side}`].rotation.x), 0, 0);
    }
    // ---- arms ----
    const armAmp = lerp(0.4, 0.9, rb) * mb * (1 + 0.25 * fleeW) * (1 - 0.5 * invW);
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = -sw * s;
      bones[`upperArm${side}`].rotation.set(a * armAmp + lean + 0.05 + 0.25 * rb + 0.15 * invW, 0,
        s * -0.16 - (1 - mb) * s * 0.04 * Math.sin(idleT) - 0.15 * stareW * s);
      bones[`forearm${side}`].rotation.set(0.25 + 0.9 * rb + Math.max(0, a) * 0.3 * mb + 0.25 * invW, 0, 0);
      const curl = lerp(0.35 + rb * 0.6 + (1 - mb) * Math.sin(idleT * 0.7 + s) * 0.08, 0.05, stareW);   // claws splay when staring
      for (let f = 0; f < 4; f++) bones[`finger${side}${f}`].rotation.x = curl;
    }

    // ---- knock: rear back and club the trunk with the right arm, `count` times ----
    if (action?.name === 'knock') {
      action.t += dt;
      const t = action.t, total = KNOCK.windup + (action.count - 1) * KNOCK.gap + KNOCK.recover;
      if (t >= total) { action = null; return; }
      const w = ease(Math.min(1, t / 0.2, (total - t) / 0.25));          // blend in / out
      // Where in the current strike are we? Each strike: raise (to the hit), snap down, settle.
      const local = t < KNOCK.windup ? t / KNOCK.windup : ((t - KNOCK.windup) % KNOCK.gap) / KNOCK.gap;
      const raising = t < KNOCK.windup || local > 0.45;
      const lift = t < KNOCK.windup ? ease(local) : local > 0.45 ? ease((local - 0.45) / 0.55) : 1 - ease(Math.min(1, local / 0.12));
      const R = bones.upperArmR, F = bones.forearmR;
      R.rotation.x = lerp(R.rotation.x, lerp(1.25, 2.75, lift), w);      // overhead -> forward strike
      R.rotation.z = lerp(R.rotation.z, 0.25, w);
      F.rotation.x = lerp(F.rotation.x, lerp(0.35, 1.3, lift), w);
      for (let f = 0; f < 4; f++) bones[`fingerR${f}`].rotation.x = lerp(bones[`fingerR${f}`].rotation.x, 1.1, w);   // fist
      bones.chest.rotation.y = lerp(bones.chest.rotation.y, raising ? -0.3 * lift : 0.18, w);                       // twist into it
      bones.spine.rotation.x -= 0.12 * w * (1 - lift);                                                                // body follows through
      bones.neck.rotation.y = lerp(bones.neck.rotation.y, 0.25, w);
      bones.jaw.rotation.x += 0.15 * w;
    }
  };
  root.userData.animate(0, 0);
  root.userData.bones = bones;
  return root;
}

import * as THREE from 'three';
import { pixelMaterial, furTexture, skinTexture, bigfootFaceTexture } from '../art/pixelTex.js';

// Blockout Bigfoot (L1): a low-poly, pixel-textured body on a simple bone hierarchy, animated
// procedurally — walk and run cycles driven by how fast it's actually moving, plus an idle
// (breathing, slow head turns). Faces -Z with its feet at the origin, 2.4 m tall, like the
// capsule it replaces.
//
//   root ─ hips ─ spine ─ chest ─ neck ─ head
//                       └ shoulderL/R ─ upperArm ─ forearm ─ hand
//          hips ─ thighL/R ─ shin ─ foot

const FWD = -1;   // model forward is -Z

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
  // Tile the fur so strands are a consistent size: ~ppm texture repeats per metre.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * ppm, uv.getY(i) * h * ppm * 0.5);
  g.computeVertexNormals();
  return g;
}

export function buildBigfootModel(profile) {
  const fur = pixelMaterial(furTexture(0), { flatShading: true });
  const furDark = pixelMaterial(furTexture(1), { flatShading: true });
  const skin = pixelMaterial(skinTexture(), { flatShading: true });
  const face = pixelMaterial(bigfootFaceTexture(), { flatShading: true });
  // Faint eyeshine so it can catch your torch from the dark.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });

  const root = new THREE.Group();
  root.name = `cryptid-${profile.id}`;
  const bones = {};
  const part = (name, parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    parent.add(m);
    bones[name] = m;
    return m;
  };
  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); bones[name] = g; return g;
  };

  // Hips at ~1.05 m. Torso is big and hunched; legs comparatively short; arms hang to the knees.
  const hips = joint('hips', root, 0, 1.08, 0);
  part('pelvis', hips, limbGeo(0.62, 0.32, 0.42, { taper: 1.05, pivot: 'center' }), fur, 0, 0, 0);
  const spine = joint('spine', hips, 0, 0.12, 0);
  part('belly', spine, limbGeo(0.66, 0.42, 0.46, { taper: 0.95, pivot: 'bottom' }), fur, 0, 0, 0);
  const chest = joint('chest', spine, 0, 0.4, 0);
  part('ribcage', chest, limbGeo(0.86, 0.5, 0.56, { taper: 0.75, taperD: 0.85, pivot: 'bottom' }), furDark, 0, 0, 0.02);
  // Hump of muscle across the shoulders/back.
  part('hump', chest, limbGeo(0.7, 0.22, 0.34, { taper: 1.2, pivot: 'bottom' }), furDark, 0, 0.44, 0.1);
  const neck = joint('neck', chest, 0, 0.58, FWD * 0.08);
  // Head: face material on the front; a crested skull on top.
  const headGeo = limbGeo(0.34, 0.36, 0.36, { taper: 1.1, pivot: 'bottom', ppm: 3 });
  const headMats = [fur, fur, furDark, fur, fur, face];   // +x -x +y -y +z -z
  const head = new THREE.Mesh(headGeo, headMats);
  head.position.set(0, 0, FWD * 0.06); head.castShadow = true; head.name = 'head';
  neck.add(head); bones.head = head;
  // The face shows the whole face texture once (not tiled): UVs from the vertex positions.
  const uv = headGeo.attributes.uv, hp = headGeo.attributes.position, faceGroup = headGeo.groups[5];
  for (let i = faceGroup.start; i < faceGroup.start + faceGroup.count; i++) {
    const vi = headGeo.index.getX(i);
    uv.setXY(vi, 0.5 - hp.getX(vi) / 0.36, hp.getY(vi) / 0.36);
  }
  part('crest', head, limbGeo(0.12, 0.1, 0.3, { taper: 2, pivot: 'bottom' }), furDark, 0, 0.35, 0.02);
  part('brow', head, limbGeo(0.36, 0.07, 0.08, { pivot: 'center' }), furDark, 0, 0.25, FWD * 0.19);
  part('muzzle', head, limbGeo(0.22, 0.13, 0.08, { taper: 0.8, pivot: 'center', ppm: 2 }), skin, 0, 0.09, FWD * 0.2);
  for (const x of [-0.075, 0.075]) part(`eye${x}`, head, new THREE.BoxGeometry(0.035, 0.022, 0.01), eyeMat, x, 0.195, FWD * 0.183).castShadow = false;

  // Arms.
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const sh = joint(`shoulder${side}`, chest, s * 0.5, 0.42, 0.02);
    part(`delt${side}`, sh, limbGeo(0.3, 0.26, 0.3, { taper: 0.8, pivot: 'top' }), furDark, 0, 0.1, 0);
    const upper = joint(`upperArm${side}`, sh, 0, 0, 0);
    part(`upperArmMesh${side}`, upper, limbGeo(0.22, 0.58, 0.24, { taper: 0.8 }), fur, 0, 0, 0);
    const fore = joint(`forearm${side}`, upper, 0, -0.56, 0);
    part(`forearmMesh${side}`, fore, limbGeo(0.2, 0.52, 0.21, { taper: 0.75 }), fur, 0, 0, 0);
    const hand = joint(`hand${side}`, fore, 0, -0.5, 0);
    part(`handMesh${side}`, hand, limbGeo(0.14, 0.22, 0.1, { taper: 0.8, ppm: 2 }), skin, 0, 0, FWD * 0.01);
  }
  // Legs.
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const thigh = joint(`thigh${side}`, hips, s * 0.2, -0.08, 0);
    part(`thighMesh${side}`, thigh, limbGeo(0.28, 0.52, 0.3, { taper: 0.75 }), fur, 0, 0, 0);
    const shin = joint(`shin${side}`, thigh, 0, -0.5, 0);
    part(`shinMesh${side}`, shin, limbGeo(0.21, 0.46, 0.22, { taper: 0.8 }), fur, 0, 0, 0);
    const foot = joint(`foot${side}`, shin, 0, -0.45, 0);
    // Big flat foot (the famous 45 cm print), toes forward.
    part(`footMesh${side}`, foot, limbGeo(0.2, 0.1, 0.45, { taper: 1, pivot: 'top', ppm: 2 }), skin, 0, 0, FWD * 0.12);
  }

  // An invisible proxy keeps the AI's state tinting (debug readout) off the textured body.
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
  root.add(proxy);
  root.userData.body = proxy;

  // ---- Procedural animation -------------------------------------------------------------
  let phase = 0, idleT = Math.random() * 10, runBlend = 0, moveBlend = 0;
  const STRIDE = 1.5;            // metres per full walk cycle step pair (matches the footprint stride)
  root.userData.animate = (dt, speed = 0, state = 'roam') => {
    idleT += dt;
    const moving = THREE.MathUtils.clamp(speed / 0.6, 0, 1);
    moveBlend += (moving - moveBlend) * Math.min(1, dt * 6);
    const run = THREE.MathUtils.clamp((speed - 2.6) / 2.5, 0, 1);
    runBlend += (run - runBlend) * Math.min(1, dt * 4);
    const stride = THREE.MathUtils.lerp(STRIDE, STRIDE * 1.9, runBlend);
    phase += (speed / stride) * Math.PI * dt;      // one leg swing per half stride
    const sw = Math.sin(phase), cw = Math.cos(phase);
    const mb = moveBlend, rb = runBlend;

    // Body: hunch deepens when running; bob twice per cycle; slight roll side to side.
    const lean = 0.25 + 0.35 * rb + (state === 'observe' ? -0.1 : 0);
    bones.hips.position.y = 1.08 - mb * (0.04 + 0.05 * rb) + Math.abs(cw) * mb * (0.05 + 0.08 * rb) + (1 - mb) * Math.sin(idleT * 1.6) * 0.008;
    bones.hips.rotation.set(0, sw * 0.12 * mb, cw * 0.04 * mb * (1 - rb));
    bones.spine.rotation.set(-lean * 0.55, -sw * 0.1 * mb, 0);
    bones.chest.rotation.set(-(lean * 0.45 + (1 - mb) * Math.sin(idleT * 1.6) * 0.03), -sw * 0.12 * mb, 0);
    // Head stays level (counter the lean), idles by looking around.
    const look = (1 - mb) * Math.sin(idleT * 0.4) * 0.6;
    bones.neck.rotation.set(lean * 0.95 - 0.05, look, 0);

    // Legs: thigh swing, knee bends on the forward swing, foot stays roughly flat.
    const legAmp = THREE.MathUtils.lerp(0.45, 0.85, rb) * mb;
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = sw * s;
      bones[`thigh${side}`].rotation.set(a * legAmp + 0.1 + 0.12 * mb, 0, 0);
      const bendPhase = Math.max(0, Math.sin(phase + (s > 0 ? 0 : Math.PI) - Math.PI / 2 + 0.4));
      bones[`shin${side}`].rotation.set(-(0.18 + bendPhase * THREE.MathUtils.lerp(0.7, 1.4, rb) * mb), 0, 0);
      bones[`foot${side}`].rotation.set(-(bones[`thigh${side}`].rotation.x + bones[`shin${side}`].rotation.x), 0, 0);
    }
    // Arms: long, loose counter-swing; pumping with bent elbows when running.
    const armAmp = THREE.MathUtils.lerp(0.4, 0.9, rb) * mb;
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = -sw * s;
      bones[`upperArm${side}`].rotation.set(a * armAmp + lean + 0.05 + 0.25 * rb, 0, s * -0.12 - (1 - mb) * s * 0.04 * Math.sin(idleT));
      bones[`forearm${side}`].rotation.set(0.25 + 0.9 * rb + Math.max(0, a) * 0.3 * mb, 0, 0);
    }
  };
  root.userData.animate(0, 0);
  root.userData.bones = bones;
  return root;
}

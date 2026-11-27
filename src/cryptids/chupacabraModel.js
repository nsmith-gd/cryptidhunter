import * as THREE from 'three';
import { capsule, ellipsoid, smin, surfaceNets, facetUV } from '../art/sdfMesh.js';
import { pixelMaterial, chupaHideTexture, chupaHeadTexture, chupaSpineTexture } from '../art/pixelTex.js';

// Chupacabra (#93): one sculpted, low-poly skinned body with pixel textures.
//
// The "goat-sucker" of the 1990s reports: a gaunt, hairless, dog-sized night predator with
// grey-green leathery hide, a hunched back with a ridge of quills, a too-big head with
// glowing red eyes, a long fanged muzzle, a thin whip tail and long, wiry legs. Low (back
// about 0.6 m), so it reads as something skulking through the reeds, not a person.
//
// Built like Bigfoot (#58): body masses are signed-distance shapes, smoothly blended and meshed
// into an even faceted surface, each shape tagged with the bone that carries it. Skin weights
// come from how close a surface point lies to each tagged shape, so joints bend smoothly.
// Animation is procedural (chupacabraAnim below): idle breathing and sniffing, a creeping
// trot that speeds into a bounding run, a coiled crouch before the leap, and the lunge.
//
// Forward is +Z (the Chupacabra class faces its mesh with rotation.y = atan2(dx, dz)).
// Units are metres; the model's origin is on the ground between its feet.

const CELL = 0.016;

// ---- skeleton ---------------------------------------------------------------------------------
const RIG = [
  ['hips', null, [0, 0.42, -0.26]],
  ['spine', 'hips', [0, 0.05, 0.22]],
  ['chest', 'spine', [0, -0.01, 0.22]],
  ['neck', 'chest', [0, 0.06, 0.14]],
  ['head', 'neck', [0, 0.06, 0.12]],
  ['jaw', 'head', [0, -0.05, 0.04]],
  ['tail1', 'hips', [0, 0.0, -0.14]],
  ['tail2', 'tail1', [0, -0.05, -0.2]],
  ['tail3', 'tail2', [0, -0.06, -0.2]],
  ...['L', 'R'].flatMap((side) => {
    const s = side === 'L' ? -1 : 1;
    return [
      [`upperArm${side}`, 'chest', [s * 0.12, -0.08, 0.04]],
      [`forearm${side}`, `upperArm${side}`, [0, -0.15, -0.05]],
      [`hand${side}`, `forearm${side}`, [0, -0.15, 0.04]],
      [`thigh${side}`, 'hips', [s * 0.11, -0.05, 0]],
      [`shin${side}`, `thigh${side}`, [0, -0.14, 0.1]],
      [`ankle${side}`, `shin${side}`, [0, -0.13, -0.1]],
      [`foot${side}`, `ankle${side}`, [0, -0.08, 0.04]],
    ];
  }),
];

function jointPositions() {
  const pos = {};
  for (const [name, parent, o] of RIG) {
    const p = parent ? pos[parent] : [0, 0, 0];
    pos[name] = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  }
  return pos;
}

// ---- the sculpt -------------------------------------------------------------------------------
function sculpt(J) {
  const parts = [];
  const E = (bone, c, r, k = 0.04) => parts.push({ bone, f: ellipsoid(c, r), k });
  const C = (bone, a, b, ra, rb, k = 0.03) => parts.push({ bone, f: capsule(a, b, ra, rb), k });
  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  // Torso: bony pelvis and haunches, a pinched starved waist, a deep keel of a ribcage.
  E('hips', add(J.hips, [0, -0.01, -0.02]), [0.105, 0.1, 0.13]);
  E('spine', add(J.spine, [0, -0.04, 0]), [0.08, 0.075, 0.14], 0.05);          // gaunt waist
  E('spine', add(J.spine, [0, 0.02, -0.02]), [0.045, 0.05, 0.16], 0.04);       // hunched spine ridge
  E('chest', add(J.chest, [0, -0.06, 0.02]), [0.12, 0.15, 0.16], 0.05);        // deep keel chest
  E('chest', add(J.chest, [0, 0.03, 0.06]), [0.115, 0.07, 0.1], 0.04);         // shoulder blades
  // Neck thrust forward and low, a heavy skull, a long tapering muzzle and the underslung jaw.
  C('neck', add(J.neck, [0, -0.04, -0.04]), add(J.head, [0, -0.02, -0.02]), 0.07, 0.055, 0.04);
  E('head', add(J.head, [0, 0.02, 0.03]), [0.07, 0.066, 0.078], 0.03);
  C('head', add(J.head, [0, 0.0, 0.08]), add(J.head, [0, -0.03, 0.2]), 0.04, 0.018, 0.025);   // muzzle
  C('head', add(J.head, [-0.055, 0.055, 0.06]), add(J.head, [0.055, 0.055, 0.06]), 0.024, 0.024, 0.02);   // brow ridge
  for (const s of [-1, 1]) C('head', add(J.head, [s * 0.05, 0.06, -0.03]), add(J.head, [s * 0.085, 0.14, -0.08]), 0.022, 0.006, 0.015);   // swept-back ears
  C('jaw', add(J.jaw, [0, -0.01, 0.02]), add(J.jaw, [0, -0.02, 0.15]), 0.028, 0.014, 0.02);
  // Tail: a thin whip.
  C('tail1', J.tail1, J.tail2, 0.04, 0.03, 0.03);
  C('tail2', J.tail2, J.tail3, 0.03, 0.018, 0.02);
  C('tail3', J.tail3, add(J.tail3, [0, -0.04, -0.22]), 0.018, 0.006, 0.015);
  for (const side of ['L', 'R']) {
    // Front legs: wiry, with knobbed elbows.
    C(`upperArm${side}`, add(J[`upperArm${side}`], [0, 0.04, 0]), J[`forearm${side}`], 0.05, 0.03, 0.04);
    C(`forearm${side}`, J[`forearm${side}`], J[`hand${side}`], 0.026, 0.018, 0.015);
    E(`hand${side}`, add(J[`hand${side}`], [0, -0.04, 0.035]), [0.03, 0.022, 0.05], 0.015);
    // Hind legs: a muscled haunch, then long bare digitigrade shins (a goat's hock).
    E(`thigh${side}`, add(J[`thigh${side}`], [0, -0.06, 0.02]), [0.055, 0.1, 0.08], 0.04);
    C(`shin${side}`, J[`shin${side}`], J[`ankle${side}`], 0.032, 0.02, 0.02);
    C(`ankle${side}`, J[`ankle${side}`], J[`foot${side}`], 0.019, 0.017, 0.015);
    E(`foot${side}`, add(J[`foot${side}`], [0, -0.005, 0.04]), [0.028, 0.02, 0.05], 0.015);
  }
  const sdf = (x, y, z) => {
    let d = Infinity;
    for (const p of parts) { const v = p.f(x, y, z); d = d === Infinity ? v : smin(d, v, p.k); }
    return d;
  };
  return { parts, sdf };
}

// ---- skinning ---------------------------------------------------------------------------------
// Each surface point follows the bones of the shapes it lies on, weighted by how close it is to
// each (1 / distance^4, top 4). Where two shapes blend (a knee, the neck), the point is shared.
function skin(geo, parts, names) {
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const acc = new Float32Array(names.length);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    acc.fill(0);
    for (const p of parts) {
      const d = Math.max(0, p.f(x, y, z)) + 0.006;
      acc[names.indexOf(p.bone)] += 1 / (d * d * d * d);
    }
    const top = [...acc.keys()].filter((j) => acc[j] > 0).sort((a, b) => acc[b] - acc[a]).slice(0, 4);
    let tot = 0; for (const j of top) tot += acc[j];
    top.forEach((j, k) => { si[i * 4 + k] = j; sw[i * 4 + k] = acc[j] / tot; });
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}

let GEO = null;   // the sculpt is the same for every Chupacabra: mesh it once
function buildGeometry() {
  if (GEO) return GEO;
  const J = jointPositions();
  const { parts, sdf } = sculpt(J);
  const raw = surfaceNets(sdf, [-0.22, -0.03, -1.12], [0.22, 0.8, 0.72], CELL, { smooth: 2 });
  // Materials: 0 hide, 1 belly (underside of chest and waist), 2 head.
  const headZ = J.head[2] - 0.06;
  const geo = facetUV(raw, 3, (c, nm) => (c.z > headZ && c.y > 0.45 ? 2 : nm.y < -0.45 && c.y > 0.25 && c.z > -0.4 ? 1 : 0));
  skin(geo, parts, RIG.map(([name]) => name));
  GEO = { geo, J };
  return GEO;
}

// ---- procedural animation ---------------------------------------------------------------------
/**
 * animate(dt, speed m/s, state) with state 'stalk' | 'windup' | 'charge' | 'retreat' | 'feed' |
 * 'idle'. Gait: a creeping walk below ~1 m/s, a trot, and a bounding run above ~6 m/s. Diagonal
 * legs move together (trot); in the run the hind pair drives together and the back flexes.
 */
function createAnimator(root, body, bones) {
  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, b.quaternion.clone()]));
  const restY = body.position.y;
  let phase = 0, t = 0, blendMove = 0, crouch = 0, sniff = 0, sniffT = 2;
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const rot = (name, x = 0, y = 0, z = 0) => { e.set(x, y, z); bones[name].quaternion.copy(rest[name]).multiply(q.setFromEuler(e)); };
  const s = { clip: 'idle' };
  s.animate = (dt, speed = 0, state = 'idle') => {
    t += dt;
    const run = state === 'charge' || speed > 6;
    const moving = speed > 0.15;
    s.clip = state === 'windup' ? 'crouch' : run && moving ? 'run' : moving ? 'walk' : 'idle';
    blendMove += ((moving ? 1 : 0) - blendMove) * Math.min(1, dt * 8);
    crouch += ((state === 'windup' ? 1 : state === 'stalk' && moving ? 0.35 : 0) - crouch) * Math.min(1, dt * (state === 'windup' ? 10 : 4));
    // Stride: ~0.5 m per cycle walking, 1.1 m running.
    const stride = run ? 1.1 : 0.5;
    phase += (speed * dt) / stride * Math.PI * 2;
    const A = blendMove * (run ? 0.85 : 0.5);
    const sp = (k) => Math.sin(phase + k), cp = (k) => Math.cos(phase + k);
    // Trot: FL with HR, FR with HL. Run (bound): both hinds together, both fronts together.
    const off = run ? { upperArmL: 0, upperArmR: 0.4, thighL: Math.PI, thighR: Math.PI + 0.4 } : { upperArmL: 0, upperArmR: Math.PI, thighL: Math.PI, thighR: 0 };
    for (const side of ['L', 'R']) {
      const fa = off[`upperArm${side}`], ha = off[`thigh${side}`];
      rot(`upperArm${side}`, -sp(fa) * A * 0.9 + crouch * 0.5);
      rot(`forearm${side}`, Math.max(0, cp(fa)) * A * 1.2 - crouch * 0.9);
      rot(`hand${side}`, -Math.max(0, cp(fa)) * A * 0.8 + crouch * 0.4);
      rot(`thigh${side}`, sp(ha) * A * 0.8 - crouch * 0.6);
      rot(`shin${side}`, -Math.max(0, cp(ha)) * A * 0.7 + crouch * 0.9);
      rot(`ankle${side}`, Math.max(0, cp(ha)) * A * 0.9 - crouch * 0.6);
      rot(`foot${side}`, -sp(ha) * A * 0.3);
    }
    // Breathing, sniffing the air, a twitching tail.
    const breath = Math.sin(t * (state === 'windup' ? 9 : 2.4)) * 0.03;
    sniffT -= dt;
    if (sniffT <= 0) { sniff = (Math.random() - 0.5) * 1.1; sniffT = 1.2 + Math.random() * 2.5; }
    const idle = 1 - blendMove;
    const flex = run ? Math.sin(phase * 2) * 0.12 * blendMove : 0;
    rot('spine', breath + flex - crouch * 0.12);
    rot('chest', -breath * 0.6 - flex + crouch * 0.1, 0, 0);
    rot('neck', -0.15 * idle + Math.sin(t * 7) * 0.04 * idle + crouch * 0.35 - (run ? 0.25 : 0) * blendMove, sniff * 0.6 * idle);
    rot('head', Math.sin(t * 13) * 0.03 * idle, sniff * 0.4 * idle, Math.sin(t * 0.9) * 0.08 * idle);
    rot('jaw', state === 'windup' ? 0.45 : state === 'charge' ? 0.6 : 0.03 + Math.max(0, Math.sin(t * 0.7)) * 0.06);
    const whip = Math.sin(t * (moving ? 6 : 1.7)) * (moving ? 0.35 : 0.25);
    rot('tail1', 0.25 - crouch * 0.5, whip * 0.5);
    rot('tail2', 0.15, whip * 0.8);
    rot('tail3', 0.1, whip);
    body.position.y = restY - crouch * 0.12 + (run ? Math.abs(Math.sin(phase)) * 0.06 * blendMove : Math.abs(Math.sin(phase)) * 0.015 * blendMove);
  };
  return s;
}

// ---- build ------------------------------------------------------------------------------------
export function buildChupacabraModel() {
  const { geo, J } = buildGeometry();
  const root = new THREE.Group();
  root.name = 'cryptid-chupacabra';
  const body = new THREE.Group();
  body.name = 'chupacabra-body';
  root.add(body);
  const bones = {}, list = [];
  for (const [name, parent, o] of RIG) {
    const b = new THREE.Bone();
    b.name = name; b.position.set(...o);
    (parent ? bones[parent] : body).add(b);
    bones[name] = b; list.push(b);
  }
  const hide = pixelMaterial(chupaHideTexture(0), { roughness: 0.75 });
  const belly = pixelMaterial(chupaHideTexture(1), { roughness: 0.8 });
  const head = pixelMaterial(chupaHeadTexture(), { roughness: 0.7 });
  const mesh = new THREE.SkinnedMesh(geo, [hide, belly, head]);
  mesh.name = 'chupacabra-skin';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  body.add(mesh);
  body.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));

  // Head-local offsets: bones carry world bind positions, so subtract the joint.
  const at = (bone, p) => p.map((v, i) => v - J[bone][i]);
  // Eyes: big, red, glowing, set forward under the brow.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a1e });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  for (const sx of [-1, 1]) {
    const p = at('head', [sx * 0.05, J.head[1] + 0.03, J.head[2] + 0.085]);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), eyeMat);
    eye.position.set(...p); eye.scale.set(1, 0.7, 0.7);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.024), glowMat);
    glow.position.set(p[0] + sx * 0.005, p[1], p[2] + 0.012);
    bones.head.add(eye, glow);
  }
  // Quills: a ridge of long spines from the nape down the hunched back, longest over the shoulders.
  const spineMat = pixelMaterial(chupaSpineTexture(), { roughness: 0.5, flatShading: true });
  const ridge = [['neck', 0.05, 0.06], ['neck', -0.02, 0.09], ['chest', 0.12, 0.13], ['chest', 0.05, 0.16], ['chest', -0.03, 0.17],
    ['spine', 0.1, 0.15], ['spine', 0.03, 0.14], ['spine', -0.05, 0.12], ['hips', 0.06, 0.1], ['hips', -0.02, 0.08], ['hips', -0.1, 0.06], ['tail1', -0.08, 0.045]];
  const top = sculpt(J).sdf;   // to find the back surface above each quill
  for (const [bone, dz, len] of ridge) {
    const c = J[bone];
    let y = c[1] + 0.25;
    while (y > c[1] - 0.1 && top(0, y, c[2] + dz) > 0) y -= 0.01;
    const q = new THREE.Mesh(new THREE.ConeGeometry(len * 0.13, len, 4), spineMat);
    q.position.set(0, y - c[1] + len * 0.4, dz);
    q.rotation.x = -0.55;                                   // swept back
    bones[bone].add(q);
    for (const sx of [-1, 1]) if (len > 0.11) {             // smaller side quills over the shoulders
      const s2 = new THREE.Mesh(new THREE.ConeGeometry(len * 0.08, len * 0.55, 4), spineMat);
      s2.position.set(sx * 0.035, y - c[1] + len * 0.2, dz - 0.02);
      s2.rotation.set(-0.6, 0, -sx * 0.5);
      bones[bone].add(s2);
    }
  }
  // Fangs: two long upper fangs over the jaw, two short lower ones.
  const tooth = new THREE.MeshStandardMaterial({ color: 0xd8cfb0, roughness: 0.4, flatShading: true });
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.055, 4), tooth);
    f.position.set(...at('head', [sx * 0.022, J.head[1] - 0.055, J.head[2] + 0.17])); f.rotation.x = Math.PI;
    bones.head.add(f);
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 4), tooth);
    l.position.set(...at('jaw', [sx * 0.018, J.jaw[1] + 0.005, J.jaw[2] + 0.13]));
    bones.jaw.add(l);
    for (const k of [0.04, 0.075, 0.11]) {                  // a row of small needle teeth behind them
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.022, 3), tooth);
      n.position.set(...at('head', [sx * (0.03 - k * 0.05), J.head[1] - 0.045, J.head[2] + 0.17 - k])); n.rotation.x = Math.PI;
      bones.head.add(n);
    }
  }
  // Claws: three hooked, blood-tipped claws on every foot.
  for (const side of ['L', 'R']) for (const bone of [`hand${side}`, `foot${side}`]) {
    for (let k = -1; k <= 1; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.04, 4), spineMat);
      const base = bone.startsWith('hand') ? [0, -0.055, 0.08] : [0, -0.015, 0.085];
      c.position.set(k * 0.016, base[1], base[2]); c.rotation.x = Math.PI / 2 + 0.5;
      bones[bone].add(c);
    }
  }
  // Invisible proxy for the AI debug tint, like Bigfoot.
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
  root.add(proxy);
  root.userData.body = proxy;
  const anim = createAnimator(root, body, bones);
  root.userData.animate = anim.animate;
  Object.defineProperty(root.userData, 'clip', { get: () => anim.clip });
  root.userData.bones = bones;
  return root;
}

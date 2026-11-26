import * as THREE from 'three';

// Shared cryptid framework registries (GDD 5.2): one species definition + one shared behaviour
// controller per individual. A new cryptid is DATA: a profile (profiles.js makeProfile) that names
//   brain   a registered behaviour ('utility' by default: traits + utility-scored action library)
//   model   a registered body family ('capsule' | 'quadruped' greybox, or a species model)
//   actions which shared actions its species adapter enables (utility brain)
// Species with signature rules (Bigfoot's warn-and-charge) register their own brain once; the
// shared CryptidAI, perception, memory, navigation and clue trail are the same for everyone.

const SPECIES = new Map();
const BRAINS = new Map();
const MODELS = new Map();

export function registerSpecies(profile) { SPECIES.set(profile.id, profile); return profile; }
export function getSpecies(id) { return SPECIES.get(id) ?? null; }
export function listSpecies() { return [...SPECIES.values()]; }

/** factory(cryptid) -> Brain (brains/bt.js) or anything with tick() and pathText. */
export function registerBrain(name, factory) { BRAINS.set(name, factory); }
export function brainFactory(name) { return BRAINS.get(name) ?? BRAINS.get('utility') ?? null; }

/** builder(profile) -> THREE.Group with userData.body (tinted per state), optional userData.animate(dt, speed, state). */
export function registerModel(name, builder) { MODELS.set(name, builder); }
export function buildModel(profile) {
  const name = profile.model ?? (MODELS.has(profile.id) ? profile.id : 'capsule');
  return (MODELS.get(name) ?? MODELS.get('capsule'))(profile);
}

// ---- shared body families (greybox) -------------------------------------------------------
const glow = (color, emissive = 0x1a1410) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive });

/** Upright humanoid placeholder: a capsule with a pale "face" so heading reads. */
export function buildCapsule(profile) {
  const group = new THREE.Group();
  group.name = `cryptid-${profile.id}`;
  const r = profile.radius;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, profile.height - 2 * r), 6, 12), glow(profile.color));
  body.position.y = profile.height / 2;
  body.castShadow = body.receiveShadow = true;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, 0.15, 0.3), glow(0xd8c8a0, 0x2a2418));
  nose.position.set(0, profile.height * 0.85, -r);
  group.add(body, nose);
  group.userData.body = body;
  return group;
}

/**
 * Four-legged placeholder (ground quadruped family, GDD 5.6). Sized from the profile: height is the
 * top of the back, `length` (default 2.4 × radius) nose to tail. Legs swing with speed.
 * profile.legs: { front, back } lengths (m) let a species stand lopsided (the Sidehill Gouger).
 */
export function buildQuadruped(profile) {
  const group = new THREE.Group();
  group.name = `cryptid-${profile.id}`;
  const h = profile.height, len = profile.length ?? profile.radius * 2.4, w = profile.radius * 1.1;
  const leg = profile.legs ?? {};
  const legH = h * 0.5;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.42, len * 0.72), glow(profile.color));
  body.position.y = legH + h * 0.21;
  body.castShadow = body.receiveShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.32, len * 0.24), glow(profile.color));
  head.position.set(0, legH + h * 0.36, -len * 0.45);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, h * 0.14, len * 0.1), glow(0xcab79a, 0x2a2418));
  snout.position.set(0, legH + h * 0.3, -len * 0.6);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.15, w * 0.15, len * 0.3), glow(profile.color));
  tail.position.set(0, legH + h * 0.32, len * 0.48);
  tail.rotation.x = -0.5;
  group.add(body, head, snout, tail);
  const legs = [];
  for (const [x, z, side] of [[-1, -1, 'left'], [1, -1, 'right'], [-1, 1, 'left'], [1, 1, 'right']]) {
    const L = side === 'left' ? (leg.left ?? legH) : (leg.right ?? legH);
    const pivot = new THREE.Group();
    pivot.position.set(x * w * 0.38, legH, z * len * 0.26);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, L, w * 0.18), glow(profile.color));
    m.position.y = -L / 2;
    m.castShadow = true;
    pivot.add(m);
    pivot.userData.phase = (x * z > 0 ? 0 : Math.PI);
    group.add(pivot);
    legs.push(pivot);
  }
  // Uneven legs tilt the whole body (the gouger's hillside stance).
  if (leg.left != null || leg.right != null) group.userData.roll = Math.atan2((leg.left ?? legH) - (leg.right ?? legH), w * 0.76);
  let t = 0;
  group.userData.body = body;
  group.userData.animate = (dt, speed = 0) => {
    t += dt * (2 + speed * 2.2);
    const swing = Math.min(0.7, speed * 0.25);
    for (const p of legs) p.rotation.x = Math.sin(t + p.userData.phase) * swing;
    head.rotation.x = Math.sin(t * 0.5) * 0.05;
    if (group.userData.roll) group.rotation.z = group.userData.roll;
  };
  return group;
}

registerModel('capsule', buildCapsule);
registerModel('quadruped', buildQuadruped);

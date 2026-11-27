import * as THREE from 'three';
import { stream } from '../core/rng.js';

// Clue kinds a cryptid can leave. Lifetimes are seconds until the clue has fully faded;
// it starts fading at (1 - fadeFraction) of its life.
export const CLUE_TYPES = Object.freeze({
  footprint: { label: 'Footprint', lifetime: 150, fadeFraction: 0.3 },
  hair: { label: 'Hair tuft', lifetime: 300, fadeFraction: 0.3 },
  scratch: { label: 'Scratch marks', lifetime: 420, fadeFraction: 0.3 },
  // #84 (GDD 4.2): disturbance and biological traces, and an ordinary-animal false lead.
  branch: { label: 'Snapped branch', lifetime: 600, fadeFraction: 0.2 },    // EV04 environmental disturbance
  scat: { label: 'Droppings', lifetime: 900, fadeFraction: 0.2 },           // EV06 biological sample
  deerTrack: { label: 'Deer tracks', lifetime: 1e9, fadeFraction: 0, falseLead: true },  // GDD 4.4: ordinary animal sign
  // #99: two more ordinary-animal false leads that look like a cryptid's sign at a glance, each with
  // a cue you can learn (claws on the bear print; fur and bone in coyote droppings). HQ rejects them.
  bearTrack: { label: 'Big tracks', lifetime: 1e9, fadeFraction: 0, falseLead: true, like: 'footprint' },
  coyoteScat: { label: 'Droppings', lifetime: 1e9, fadeFraction: 0, falseLead: true, like: 'scat' },
});

// Shared geometry (one per kind); materials are per clue so each can fade on its own.
const unitDisc = new THREE.CircleGeometry(0.5, 10);
const strand = new THREE.BoxGeometry(0.012, 0.012, 1);
const slash = new THREE.BoxGeometry(0.035, 1, 0.02);

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 1, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra,
  });
}

/** Flat oval print on the ground. data: { length, width } */
export function buildFootprint(data) {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(unitDisc, mat(0x1e140c));
  sole.rotation.x = -Math.PI / 2;
  sole.scale.set(data.width, data.length * 0.78, 1);
  sole.position.set(0, 0.012, data.length * 0.08);
  // Toe row: five small dots across the front of the print.
  const toeMat = sole.material;
  for (let i = 0; i < 5; i++) {
    const toe = new THREE.Mesh(unitDisc, toeMat);
    toe.rotation.x = -Math.PI / 2;
    const s = data.width * (i === 0 ? 0.32 : 0.22);
    toe.scale.set(s, s, 1);
    toe.position.set((i - 2) * data.width * 0.23, 0.012, -data.length * 0.42 + Math.abs(i - 2) * 0.02);
    g.add(toe);
  }
  g.add(sole);
  return g;
}

/** Small clump of strands lying on the ground. data: { color } */
export function buildHair(data, rand = stream('clueArt')) {
  const g = new THREE.Group();
  const m = mat(data.color ?? 0x5a3a22, { emissive: 0x120a05 });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(strand, m);
    s.scale.z = 0.1 + rand() * 0.12;
    s.rotation.y = rand() * Math.PI;
    s.rotation.x = (rand() - 0.5) * 0.4;
    s.position.set((rand() - 0.5) * 0.08, 0.02 + rand() * 0.03, (rand() - 0.5) * 0.08);
    g.add(s);
  }
  return g;
}

/** Three parallel claw slashes on a vertical surface; group faces along +Z (surface normal). */
export function buildScratch(data) {
  const g = new THREE.Group();
  const m = mat(0xd8c7a6, { emissive: 0x241c10 });
  const len = data.length ?? 0.6;
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(slash, m);
    s.scale.y = len * (i === 0 ? 1 : 0.85);
    s.rotation.z = 0.35;
    s.position.set(i * 0.08, 0, 0.012);
    g.add(s);
  }
  return g;
}

const twig = new THREE.BoxGeometry(0.035, 0.035, 1);
const lump = new THREE.DodecahedronGeometry(0.5, 0);

/** A branch snapped high on a trunk: a broken limb hanging down, pale wood showing at the break.
 *  Group faces along +Z (away from the trunk). data: { length } */
export function buildBranch(data, rand = stream('clueArt')) {
  const g = new THREE.Group();
  const bark = mat(0x4a3a2a), core = mat(0xd9c39a, { emissive: 0x2a2010 });
  const len = data.length ?? 0.7;
  const limb = new THREE.Mesh(twig, bark);
  limb.scale.set(1.2, 1.2, len);
  limb.position.set(0, -len * 0.35, 0.12);
  limb.rotation.x = 1.0 + rand() * 0.3;            // hangs down from the break
  const stub = new THREE.Mesh(twig, core);          // the fresh pale break on the trunk
  stub.scale.set(1.6, 1.6, 0.12);
  stub.position.set(0, 0, 0.05);
  g.add(limb, stub);
  for (let i = 0; i < 4; i++) {                     // a few twigs still on the broken limb
    const t = new THREE.Mesh(twig, bark);
    t.scale.set(0.5, 0.5, 0.15 + rand() * 0.15);
    t.position.set((rand() - 0.5) * 0.1, -len * (0.3 + rand() * 0.5), 0.15 + rand() * 0.1);
    t.rotation.set(rand() * 2, rand() * 3, 0);
    g.add(t);
  }
  return g;
}

/** A pile of dark droppings on the ground. data: { size } */
export function buildScat(data, rand = stream('clueArt')) {
  const g = new THREE.Group();
  const m = mat(0x1c130b, { emissive: 0x0c0703, roughness: 0.5 });   // dark and a little glossy: reads under the torch
  const k = data.size ?? 1;
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(lump, m);
    const s = (0.07 + rand() * 0.05) * k;
    p.scale.set(s * 1.4, s, s);
    p.position.set((rand() - 0.5) * 0.18 * k, s * 0.5, (rand() - 0.5) * 0.18 * k);
    p.rotation.y = rand() * 3;
    g.add(p);
  }
  return g;
}

/** A deer's split-hoof print: two small teardrops, pointing the way it walked. */
export function buildDeerTrack() {
  const g = new THREE.Group();
  const m = mat(0x120c06);
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(unitDisc, m);
    h.rotation.x = -Math.PI / 2;
    h.scale.set(0.045, 0.1, 1);
    h.position.set(side * 0.028, 0.012, 0);
    g.add(h);
  }
  return g;
}

/** A black bear's print: broad short pad, five short toes in a tight arc, a claw mark ahead of each. */
export function buildBearTrack() {
  const g = new THREE.Group();
  const m = mat(0x150e08);
  const pad = new THREE.Mesh(unitDisc, m);
  pad.rotation.x = -Math.PI / 2;
  pad.scale.set(0.15, 0.13, 1);                       // wider than long: nothing like a long bare foot
  pad.position.set(0, 0.012, 0.03);
  g.add(pad);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.36, x = Math.sin(a) * 0.1, z = -0.05 - Math.cos(a) * 0.06;
    const toe = new THREE.Mesh(unitDisc, m);
    toe.rotation.x = -Math.PI / 2;
    toe.scale.set(0.035, 0.035, 1);
    toe.position.set(x, 0.012, z);
    const claw = new THREE.Mesh(unitDisc, m);          // the giveaway: claw pricks out in front of the toes
    claw.rotation.x = -Math.PI / 2;
    claw.scale.set(0.012, 0.03, 1);
    claw.position.set(x * 1.25, 0.012, z - 0.045);
    g.add(toe, claw);
  }
  return g;
}

/** Coyote droppings: thin, twisted, tapered ends, flecked with pale fur and bone chips. */
export function buildCoyoteScat(data, rand = stream('clueArt')) {
  const g = new THREE.Group();
  const m = mat(0x2a241c, { roughness: 0.8 }), fleck = mat(0xcfc6b0, { emissive: 0x141210 });
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(lump, m);
    p.scale.set(0.11, 0.035, 0.035);
    p.position.set((rand() - 0.5) * 0.12, 0.02, (rand() - 0.5) * 0.12);
    p.rotation.y = rand() * 3;
    g.add(p);
  }
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(lump, fleck);
    f.scale.setScalar(0.012);
    f.position.set((rand() - 0.5) * 0.14, 0.04, (rand() - 0.5) * 0.14);
    g.add(f);
  }
  return g;
}

export const BUILDERS = { footprint: buildFootprint, hair: buildHair, scratch: buildScratch, branch: buildBranch, scat: buildScat, deerTrack: buildDeerTrack,
  bearTrack: buildBearTrack, coyoteScat: buildCoyoteScat };

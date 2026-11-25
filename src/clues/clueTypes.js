import * as THREE from 'three';

// Clue kinds a cryptid can leave. Lifetimes are seconds until the clue has fully faded;
// it starts fading at (1 - fadeFraction) of its life.
export const CLUE_TYPES = Object.freeze({
  footprint: { label: 'Footprint', lifetime: 150, fadeFraction: 0.3 },
  hair: { label: 'Hair tuft', lifetime: 300, fadeFraction: 0.3 },
  scratch: { label: 'Scratch marks', lifetime: 420, fadeFraction: 0.3 },
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
export function buildHair(data, rand = Math.random) {
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

export const BUILDERS = { footprint: buildFootprint, hair: buildHair, scratch: buildScratch };

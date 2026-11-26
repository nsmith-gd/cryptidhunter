import * as THREE from 'three';
import { stream } from '../core/rng.js';
const ROCK_RNG = (...a) => stream('rocks')(...a);

// Thrown rocks (Bigfoot's warning). A rock arcs from the thrower's hand to a landing spot;
// on landing it thuds, kicks up a little dust and reports where it fell.
const ROCK_GEO = new THREE.DodecahedronGeometry(0.16, 0);
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0x5b574f, roughness: 1, flatShading: true });

export class Rocks {
  constructor(scene) { this.scene = scene; this.flying = []; this.resting = []; }

  /** Throw from `from` (with y) to land at `to` ({x,z}); onLand(rock) when it hits the ground. */
  throw(from, to, { flightTime = 1.1, onLand = () => {} } = {}) {
    const mesh = new THREE.Mesh(ROCK_GEO, ROCK_MAT);
    mesh.castShadow = true;
    mesh.position.set(from.x, from.y, from.z);
    mesh.name = 'thrown-rock';
    this.scene.add(mesh);
    this.flying.push({ mesh, from: { ...from }, to: { x: to.x, y: 0.12, z: to.z }, t: 0, T: flightTime, onLand, spin: new THREE.Vector3(ROCK_RNG(), ROCK_RNG(), ROCK_RNG()) });
  }

  update(dt) {
    for (const r of this.flying) {
      r.t = Math.min(r.T, r.t + dt);
      const k = r.t / r.T, apex = 2.2 + Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z) * 0.18;
      r.mesh.position.set(
        r.from.x + (r.to.x - r.from.x) * k,
        r.from.y + (r.to.y - r.from.y) * k + apex * 4 * k * (1 - k),
        r.from.z + (r.to.z - r.from.z) * k);
      r.mesh.rotation.x += r.spin.x * 12 * dt; r.mesh.rotation.y += r.spin.y * 12 * dt;
      if (r.t >= r.T) { r.landed = true; r.onLand({ x: r.to.x, z: r.to.z }); this.resting.push(r.mesh); }
    }
    this.flying = this.flying.filter((r) => !r.landed);
    while (this.resting.length > 12) this.resting.shift().removeFromParent();
  }
}

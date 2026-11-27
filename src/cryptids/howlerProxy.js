import * as THREE from 'three';
import { ScentTracker } from './scent.js';
import { groundAt } from '../maps/ground.js';

// Scent-following proxy (#143; L07 Ozark Howler greybox): a low, long-legged box of a predator
// that hunts by nose alone. It reads only the world's scent traces (ScentTracker): it notices a
// trace on the wind, walks to it, then follows the trail drop by drop toward the fresher end,
// casting about where it breaks. Spawn with ?howler (and on the Ozark map). No attack yet: this
// is the perception channel and trail following; stalk and pursuit come with the Howler itself.

export const HOWLER_PROXY = { approachSpeed: 1.8, followSpeed: 2.6, turnRate: 6 };

export class HowlerProxy {
  constructor({ scene, field, x = 0, z = 0 }) {
    this.name = 'Howler (proxy)';
    this.tracker = new ScentTracker(field);
    const g = new THREE.Group();
    g.name = 'howler-proxy';
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a2a, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.3), mat); body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.32, 0.45), mat); head.position.set(0, 0.75, 0.8); head.rotation.x = 0.4;   // nose down
    g.add(body, head);
    for (const [lx, lz] of [[-0.2, 0.5], [0.2, 0.5], [-0.2, -0.5], [0.2, -0.5]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), mat); leg.position.set(lx, 0.35, lz); g.add(leg);
    }
    const eyes = new THREE.MeshBasicMaterial({ color: 0xffb040 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), eyes); e.position.set(s * 0.1, 0.82, 1.03); g.add(e); }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.position.set(x, groundAt(x, z), z);
    scene.add(g);
    this.mesh = g;
    this.trail = [];             // where it walked (for checks)
  }

  get position() { return this.mesh.position; }
  get state() { return this.tracker.state; }

  update(dt) {
    const p = this.mesh.position;
    this.tracker.update(p.x, p.z, dt);
    const w = this.tracker.waypoint();
    if (!w) return;
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, (this.tracker.state === 'follow' ? HOWLER_PROXY.followSpeed : HOWLER_PROXY.approachSpeed) * dt);
    if (d > 0.01) {
      p.x += (dx / d) * step; p.z += (dz / d) * step;
      const yaw = Math.atan2(dx, dz);
      this.mesh.rotation.y += Math.atan2(Math.sin(yaw - this.mesh.rotation.y), Math.cos(yaw - this.mesh.rotation.y)) * Math.min(1, HOWLER_PROXY.turnRate * dt);
    }
    p.y = groundAt(p.x, p.z);
    if (!this.trail.length || Math.hypot(p.x - this.trail.at(-1).x, p.z - this.trail.at(-1).z) > 0.5) this.trail.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  }
}

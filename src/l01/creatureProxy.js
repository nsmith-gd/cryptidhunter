import * as THREE from 'three';
import { furTexture } from '../art/pixelTex.js';
import { cellToWorld } from './tunnelLayout.js';

// The tunnel creature, tutorial proxy (GDD 1.5 L01, 5.4: "shelters in side chambers; avoids light
// and nearby noise; brief curiosity. Observe, vocalize, retreat; no deliberate attacks or chase").
//
//   hidden   -> watching  when you come within sight range of its glimpse spot: a hunched shape
//                          at the edge of the light, eyes catching your torch, head turned to you
//   watching -> fleeing   when you get close, shine the torch on it, or after a few seconds of
//                          curiosity: it gives a low chitter and scuttles into its side chamber
//   fleeing  -> gone      out of sight down the chamber: it never comes back this attempt
// It never approaches you, never chases and cannot touch you (no collision, no damage path).

export const CREATURE = {
  seeRange: 24,        // m: it shows itself when you are this close to its spot
  fleeRange: 11,       // m: closer than this and it bolts
  lightRange: 20,      // m: your beam on it within this range makes it bolt
  curiosity: 5,        // s: how long it watches before slipping away on its own
  fleeSpeed: 5.5,      // m/s (you walk ~2 m/s down here)
  height: 1.25,
};

export class CreatureProxy {
  constructor(scene, option, { onEvent = () => {}, isLit = () => false, canSee = () => true, playChitter = () => {} } = {}) {
    this.canSee = canSee;
    this.option = option;
    this.onEvent = onEvent;
    this.isLit = isLit;
    this.playChitter = playChitter;
    this.state = 'hidden';
    this.t = 0;
    this.closest = Infinity;
    this.route = option.retreat.map((c) => { const p = cellToWorld(c); return new THREE.Vector3(p.x, 0, p.z); });
    this.leg = 0;
    this.mesh = this.build();
    const g = cellToWorld(option.glimpse);
    this.mesh.position.set(g.x, 0, g.z);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  build() {
    const g = new THREE.Group(); g.name = 'creature-proxy';
    const fur = new THREE.MeshStandardMaterial({ map: furTexture(1), color: 0x3a312b, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), fur);
    body.scale.set(0.9, 1.15, 1.2); body.position.y = 0.72; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 5), fur);
    head.position.set(0, 1.12, -0.42); g.add(head);
    this.head = head;
    const eye = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    for (const s of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), eye); e.position.set(s * 1.2, 0.05, -0.24); head.add(e); }
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.8, 5), fur);
      arm.position.set(s * 0.42, 0.42, -0.3); arm.rotation.x = 0.4; g.add(arm);
    }
    return g;
  }

  /** player: { position }; dt seconds. */
  update(dt, player) {
    if (this.state === 'gone') return;
    this.t += dt;
    const p = player.position, m = this.mesh.position;
    const d = Math.hypot(p.x - m.x, p.z - m.z);
    if (this.state !== 'hidden') this.closest = Math.min(this.closest, d);
    if (this.state === 'hidden') {
      if (d < CREATURE.seeRange && this.canSee(p, m)) {   // only where you could actually see it
        this.state = 'watching'; this.t = 0; this.mesh.visible = true;
        this.onEvent('creature-watching', { distance: +d.toFixed(1), where: this.option.side });
      }
      return;
    }
    if (this.state === 'watching') {
      this.mesh.rotation.y = Math.atan2(-(p.x - m.x), -(p.z - m.z));        // turns its head to you
      this.head.rotation.z = Math.sin(this.t * 2.2) * 0.25;                   // a curious tilt
      const lit = d < CREATURE.lightRange && this.isLit(this.mesh.position.clone().setY(1));
      const why = d < CREATURE.fleeRange ? 'you came close' : lit ? 'your light' : this.t > CREATURE.curiosity ? 'lost interest' : null;
      if (why) {
        this.state = 'fleeing'; this.leg = 1; this.playChitter();
        this.onEvent('creature-fled', { distance: +d.toFixed(1), why });
      }
      return;
    }
    // fleeing: scuttle along the retreat cells, then into the chamber and gone.
    const target = this.route[this.leg];
    const to = target.clone().sub(m); to.y = 0;
    const step = CREATURE.fleeSpeed * dt;
    if (to.length() <= step) {
      m.copy(target);
      this.leg++;
      if (this.leg >= this.route.length) { this.state = 'gone'; this.mesh.visible = false; this.onEvent('creature-gone', { closest: +this.closest.toFixed(1) }); }
    } else {
      to.normalize();
      m.addScaledVector(to, step);
      this.mesh.rotation.y = Math.atan2(-to.x, -to.z);
      this.mesh.position.y = Math.abs(Math.sin(this.t * 14)) * 0.06;      // scuttle bob
    }
  }
}

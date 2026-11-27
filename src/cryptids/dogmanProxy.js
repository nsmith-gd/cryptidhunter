import * as THREE from 'three';
import { RoutineMemory } from './routine.js';
import { groundAt } from '../maps/ground.js';

// Dogman proxy (#151; L10 Michigan Dogman greybox, GDD 5.4/5.7): a predator that learns your routine.
// It watches you with plain eyesight (a 120° cone, 40 m, blocked by solid things). What it watches,
// it remembers (RoutineMemory): the legs of the routes it sees you walk, and camps it sees you set up.
// Once it has watched you use a route twice, it goes and waits on it - it anticipates you there.
// A route it never saw you use, it knows nothing about: it can't wait for you on it. Memories fade.
// Spawn with ?dogman. No attack yet (L0): it waits, and it checks a camp it saw.

export const DOGMAN_PROXY = { sight: 40, cone: THREE.MathUtils.degToRad(60), speed: 3.2, campCheck: 45 };

const _ray = new THREE.Ray(), _hit = new THREE.Vector3();

export class DogmanProxy {
  constructor({ scene, colliders = [], x = 0, z = 0 }) {
    this.name = 'Dogman (proxy)';
    this.colliders = colliders;
    this.memory = new RoutineMemory();
    this.state = 'watch';           // watch | ambush | checkCamp
    this.target = null;
    this.heading = 0;
    this.log = [];
    const g = new THREE.Group(); g.name = 'dogman-proxy';
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a2622, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.5), mat); body.position.y = 1.35; body.rotation.x = 0.3;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.6), mat); head.position.set(0, 2.2, -0.35);
    const ears = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), mat); ears.position.set(0, 2.5, -0.25);
    g.add(body, head, ears);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), mat); leg.position.set(s * 0.2, 0.45, 0); g.add(leg); }
    const eyes = new THREE.MeshBasicMaterial({ color: 0xffd060 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), eyes); e.position.set(s * 0.1, 2.25, -0.66); g.add(e); }
    g.position.set(x, groundAt(x, z), z);
    scene.add(g);
    this.mesh = g;
  }

  get position() { return this.mesh.position; }
  note(what, extra = {}) { this.log.push({ t: +this.memory.time.toFixed(1), what, ...extra }); }

  /** Plain eyesight: in its cone, in range, nothing solid in between. */
  sees(p, h = 1.2) {
    const o = this.mesh.position, dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
    if (d > DOGMAN_PROXY.sight) return false;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (d > 3 && (fx * dx + fz * dz) / d < Math.cos(DOGMAN_PROXY.cone)) return false;
    const from = new THREE.Vector3(o.x, o.y + 2.2, o.z), to = new THREE.Vector3(p.x, (p.y ?? 0) + h, p.z);
    const dir = to.clone().sub(from), len = dir.length();
    _ray.set(from, dir.normalize());
    for (const b of this.colliders) if (!b.containsPoint(from) && _ray.intersectBox(b, _hit) && _hit.distanceTo(from) < len - 0.3) return false;
    return true;
  }

  walkTo(t, dt) {
    const p = this.mesh.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    const k = Math.min(1, DOGMAN_PROXY.speed * dt / d);
    p.x += dx * k; p.z += dz * k; p.y = groundAt(p.x, p.z);
    this.heading = Math.atan2(dx, dz); this.mesh.rotation.y = this.heading;
    return false;
  }

  /** player: { position }; camps: [{ x, z, what }] that exist in the world (tent, fire). */
  update(dt, { player, camps = [] }) {
    const M = this.memory, p = player.position;
    M.update(dt);
    const seeing = this.sees(p);
    if (seeing) { M.sampleSeen(p); if (this.state === 'watch') { this.heading = Math.atan2(p.x - this.position.x, p.z - this.position.z); this.mesh.rotation.y = this.heading; } }
    for (const c of camps) if (this.sees(c, 0.5)) { const had = M.anticipate(c.x, c.z); M.observeCamp(c.x, c.z, c.what); if (!had || had.kind !== 'camp') this.note('saw a camp', { what: c.what, x: +c.x.toFixed(1), z: +c.z.toFixed(1) }); }
    const ambush = M.ambushSpot();
    if (ambush && this.state !== 'ambush' && !(this.target && Math.hypot(this.target.x - ambush.x, this.target.z - ambush.z) < 2)) {
      this.state = 'ambush'; this.target = ambush; this.note('goes to wait on a route it watched you use', { x: +ambush.x.toFixed(1), z: +ambush.z.toFixed(1), uses: ambush.count, confidence: +ambush.confidence.toFixed(2) });
    } else if (!ambush && this.state === 'ambush') { this.state = 'watch'; this.target = null; this.note('the route memory faded'); }
    if (this.state === 'watch' && (this.campClock = (this.campClock ?? DOGMAN_PROXY.campCheck) - dt) <= 0) {
      this.campClock = DOGMAN_PROXY.campCheck;
      const camp = M.spots.filter((s) => s.kind === 'camp').sort((a, b) => M.confidenceOf(b) - M.confidenceOf(a))[0];
      if (camp) { this.state = 'checkCamp'; this.target = { x: camp.x, z: camp.z }; this.note('goes to check a camp it saw', { x: +camp.x.toFixed(1), z: +camp.z.toFixed(1) }); }
    }
    if (this.target && (this.state === 'ambush' || this.state === 'checkCamp')) {
      const there = this.walkTo(this.target, dt);
      if (there && this.state === 'checkCamp') { this.state = 'watch'; this.target = null; }
    }
  }
}

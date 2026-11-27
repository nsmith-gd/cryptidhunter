import * as THREE from 'three';
import { CaptureMachine } from '../capture/captureMachine.js';

// Gym G07: capture, containment and cargo (GDD §15.2 G07; task #150). Greybox, ?map=g07.
// A small capture yard in the woods. The specimen proxy (a stand-in Dogman) keeps a seeded routine:
// it wanders the yard, then comes to feed at the anchor - a clearly telegraphed opening - and leaves.
// Everything about the attempt goes through the shared capture state machine (#149).
//   Modules  light (G03, Dogman-rated, 2 charges) and heavy (G10, rated for a much bigger animal: not
//            compatible here, 1 charge) on the rack.
//   Crate    the transport crate (G05) by the anchor. Its restraint draws on the generator: running,
//            strain is low; off, integrity falls fast. Repair kit on the crate (2 uses).
//   Cargo    a sled on the cargo route to the truck (the delivery point). A fallen log can block it.
//   Exit     a separate foot path out: always open, whatever happens to the specimen.
// Keys (gym): 5 commit light module · Shift+5 commit heavy · 6 secure and crate it · 7 repair crate ·
//             8 emergency release · 9 stage on the sled / deliver at the truck · 0 generator on/off ·
//             L block/clear the cargo route (fallen log).

export const G07 = {
  half: 40,
  start: { x: 0, z: 28 },
  anchor: { x: 0, z: -6 },          // the feeding spot: where openings happen
  rack: { x: -6, z: 14 },
  crate: { x: 4, z: -2 },
  generator: { x: 9, z: 0 },
  sled: { x: 6, z: 4 },
  route: [{ x: 6, z: 4 }, { x: 22, z: 6 }, { x: 30, z: 18 }],    // cargo route to the truck
  log: { x: 20, z: 6 },
  truck: { x: 30, z: 20 },
  footExit: { x: -32, z: 30 },
  reach: 4,                         // metres to use the crate / sled / truck
  commitRange: 14,                  // metres from the anchor a module can be fired
  routine: { wander: 30, feed: 12 },// seconds wandering, seconds feeding (the opening)
  repair: 30, repairs: 2,
};

export function buildGymG07(scene) {
  const colliders = [];
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const box = (x, z, w, d, h, color, { collide = true, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; if (name) m.name = name;
    scene.add(m); if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const H = G07.half;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x3e4a34)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'gym-floor'; scene.add(ground);
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 3, 0x3a3a3a);
  // A ring of tree trunks round the yard (woodland staging area).
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, r = 20 + (i % 3) * 4; const x = Math.cos(a) * r, z = Math.sin(a) * r - 4; if (Math.hypot(x - G07.truck.x, z - G07.truck.z) < 8 || x < -18 && z > 18 || Math.abs(z - 6) < 3 && x > 8) continue; box(x, z, 0.6, 0.6, 7, 0x3a2e22); }
  const path = (pts, color, name) => { for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2); for (let i = 0; i <= n; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat(color)); p.rotation.x = -Math.PI / 2; p.position.set(a.x + (b.x - a.x) * i / n, 0.012, a.z + (b.z - a.z) * i / n); p.name = name; scene.add(p); } } };
  path(G07.route, 0x6a6458, 'g07-cargo-route');
  path([G07.start, { x: -20, z: 30 }, G07.footExit], 0x6a5a44, 'g07-foot-path');
  // Anchor: a stake and a feeding post; the rack; the generator; the truck; the exit sign.
  box(G07.anchor.x, G07.anchor.z, 0.3, 0.3, 1.2, 0x8a6a3a, { collide: false, name: 'g07-anchor' });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.8, 3, 32), new THREE.MeshBasicMaterial({ color: 0xc8a040, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(G07.anchor.x, 0.02, G07.anchor.z); ring.name = 'g07-anchor-ring'; scene.add(ring);
  box(G07.rack.x, G07.rack.z, 3, 1, 1.4, 0x4a4a52, { name: 'g07-module-rack' });
  box(G07.rack.x - 0.8, G07.rack.z, 0.8, 0.6, 1.8, 0x2a7a8a, { collide: false, name: 'g07-light-module' });
  box(G07.rack.x + 0.8, G07.rack.z, 1.1, 0.8, 2.1, 0x8a4a2a, { collide: false, name: 'g07-heavy-module' });
  box(G07.generator.x, G07.generator.z, 1.4, 1, 1.1, 0xb08a2a, { name: 'g07-generator' });
  box(G07.truck.x, G07.truck.z + 3, 3, 6, 2.6, 0x5a6a7a, { name: 'g07-truck' });
  box(G07.footExit.x, G07.footExit.z + 2, 3, 0.4, 2.4, 0xd0c060, { collide: false, name: 'g07-foot-exit' });
  const lamp = new THREE.PointLight(0xfff0d0, 5, 22, 1.4); lamp.position.set(2, 4, 0); scene.add(lamp);
  return {
    colliders, bounds: H, gym: 'G07', title: 'G07 Capture, containment and cargo', noBigfoot: true, level: 10,
    playerStart: { x: G07.start.x, z: G07.start.z, yaw: 0 }, exit: { ...G07.footExit, name: 'the foot path out' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] },
    safeZones: [],
    landmarks: { start: G07.start, anchor: G07.anchor, rack: G07.rack, crate: G07.crate, generator: G07.generator, sled: G07.sled, truck: G07.truck, footExit: G07.footExit },
    environment: { background: 0x1a2028, fog: { color: 0x262e38, near: 25, far: 80 }, lightLevel: 0.35, airTemp: -4 },
  };
}

/** The gym's capture systems; the harness steps them and reads their state. trace(system, type, data). */
export class G07World {
  constructor({ game, map, trace, notify = () => {} }) {
    this.g = game; this.map = map; this.trace = trace; this.notify = notify;
    this.time = 0;
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    // The specimen proxy: a hunched capsule with a head.
    const pm = new THREE.Group(); pm.name = 'gym-proxy-dogman';
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.1, 4, 8), mat(0x3a3028)); body.position.y = 1.1; body.rotation.x = 0.4;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.5), mat(0x2a2420)); head.position.set(0, 1.75, -0.45);
    pm.add(body, head); game.scene.add(pm);
    this.proxy = { mesh: pm, x: -10, z: -14, state: 'wander', t: 0, held: false, id: 'dogman-g07' };
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.2), mat(0x6a5a3a)); crate.name = 'g07-crate'; game.scene.add(crate);
    const sled = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 3), mat(0x4a4a52)); sled.name = 'g07-sled'; game.scene.add(sled);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 7, 8), mat(0x4a3a28)); log.rotation.x = Math.PI / 2; log.rotation.z = Math.PI / 2; log.name = 'g07-fallen-log'; game.scene.add(log);
    this.meshes = { crate, sled, log };
    this.crate = { x: G07.crate.x, z: G07.crate.z, id: 'crate G05', capacity: 180, mass: 60, species: ['dogman'], repairs: G07.repairs };
    this.sled = { x: G07.sled.x, z: G07.sled.z, id: 'cargo sled', capacity: 260, loaded: false };
    this.generator = { running: true };
    this.routeBlocked = false;
    this.modules = {
      light: { id: 'G03', kind: 'light capture module', charges: 2, species: ['dogman'] },
      heavy: { id: 'G10', kind: 'heavy capture module', charges: 1, species: ['grafton'] },
    };
    this.paid = [];
    this.machine = this.newMachine();
    this.place();
  }

  newMachine() {
    return new CaptureMachine({ creature: { id: this.proxy.id, species: 'dogman', mass: 140, aggression: 0.6, fear: 0.5 }, module: this.modules.light, now: () => +this.time.toFixed(2) });
  }
  log(type, data = {}) { this.trace('capture', type, data); }
  near(p, r = G07.reach) { const q = this.g.player.position; return Math.hypot(q.x - p.x, q.z - p.z) <= r; }
  get state() { return this.machine.state; }
  /** A new specimen and contract after a delivery (same yard, fresh capture record). */
  nextSpecimen() { this.proxy.id = `dogman-g07-${(this.specimens = (this.specimens ?? 1) + 1)}`; this.machine = this.newMachine(); this.proxy.state = 'wander'; this.proxy.t = 0; this.proxy.x = -10; this.proxy.z = -14; this.sled.loaded = false; this.log('next-specimen', { id: this.proxy.id }); }

  place() {
    const P = this.proxy, c = this.crate, s = this.sled, m = this.meshes;
    if (this.machine.held) { P.x = c.x; P.z = c.z; }
    P.mesh.position.set(P.x, this.machine.held ? 0.3 : 0, P.z);
    P.mesh.scale.setScalar(this.machine.held ? 0.7 : 1);
    m.crate.position.set(c.x, 0.7 + (s.loaded ? 0.3 : 0), c.z);
    m.sled.position.set(s.x, 0.15, s.z);
    m.log.position.set(G07.log.x, 0.45, G07.log.z); m.log.visible = this.routeBlocked;
  }

  /** The specimen's routine: wander the yard, then feed at the anchor (the opening), then leave. */
  routine(dt) {
    const P = this.proxy, R = G07.routine, A = G07.anchor;
    if (this.machine.held || this.state === 'delivered') return;
    P.t += dt;
    const goTo = (x, z, v) => { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); if (d > 0.05) { const k = Math.min(1, v * dt / d); P.x += dx * k; P.z += dz * k; P.mesh.rotation.y = Math.atan2(dx, dz); } return d; };
    if (P.state === 'wander') {
      const a = P.t * 0.25; goTo(Math.cos(a) * 14, -6 + Math.sin(a) * 10, 2);
      if (P.t > R.wander) { P.state = 'approach'; P.t = 0; this.log('proxy', { state: 'approach' }); }
    } else if (P.state === 'approach') {
      if (goTo(A.x, A.z, 2.5) < 0.6) { P.state = 'feeding'; P.t = 0; this.log('proxy', { state: 'feeding' }); this.notify('It\'s feeding at the anchor: this is the opening.'); this.machine.opportunity({ kind: 'feeding at the anchor' }); }
    } else if (P.state === 'feeding') {
      if (P.t > R.feed) { P.state = 'wander'; P.t = 0; this.log('proxy', { state: 'wander' }); if (this.state === 'eligible') this.machine.opportunityLost('it finished feeding and left'); }
    } else if (P.state === 'fleeing' || P.state === 'hostile' || P.state === 'recovering') {
      const away = P.state === 'hostile' ? this.g.player.position : { x: -30, z: -30 };
      goTo(away.x, away.z, P.state === 'recovering' ? 0.8 : 4);
      if (P.t > 15) { P.state = 'wander'; P.t = 0; }
    }
  }

  /** The result of a machine call: trace it, and on failure put the proxy in its plausible state. */
  result(action, r) {
    this.log(action, { ok: r.ok, state: this.state, why: r.why ?? null, charges: { light: this.modules.light.charges, heavy: this.modules.heavy.charges }, ...(r.outcome ? { creature: r.outcome } : {}) });
    if (!r.ok && r.outcome) { this.proxy.state = r.outcome; this.proxy.t = 0; this.crate.x = G07.crate.x; this.crate.z = G07.crate.z; this.sled.loaded = false; this.notify(`${r.why}: it's ${r.outcome}.`); }
    else if (!r.ok) this.notify(r.why);
    return r;
  }

  commit(which = 'light') {
    if (!this.near(G07.anchor, G07.commitRange)) return this.result('commit', { ok: false, why: 'too far from the anchor to use the module' });
    this.machine.module = this.modules[which];                // the module you're holding (its charges are its own)
    const ctx = { stillValid: this.proxy.state === 'feeding' && Math.hypot(this.proxy.x - G07.anchor.x, this.proxy.z - G07.anchor.z) < 3 };
    return this.result(`commit-${which}`, this.machine.commit(ctx));
  }
  secureAndCrate() {
    if (!this.near(this.proxy)) return this.result('secure', { ok: false, why: 'get closer to secure it' });
    const a = this.machine.secure(); if (!a.ok) return this.result('secure', a);
    this.result('secure', a);
    this.crate.x = this.proxy.x + 1; this.crate.z = this.proxy.z;
    return this.result('contain', this.machine.contain(this.crate));
  }
  repair() {
    if (!this.near(this.crate)) return this.result('repair', { ok: false, why: 'get to the crate' });
    if (!this.machine.held || this.crate.repairs <= 0) return this.result('repair', { ok: false, why: this.crate.repairs <= 0 ? 'no repair kit left' : 'nothing to repair' });
    this.crate.repairs--; this.machine.integrity = Math.min(100, this.machine.integrity + G07.repair); this.machine.warned.integrity = this.machine.integrity < 40;
    return this.result('repair', { ok: true, integrity: Math.round(this.machine.integrity) });
  }
  release() { return this.result('release', this.machine.release('emergency release')); }
  /** 9: at the crate, load it on the sled and stage it; at the truck, deliver. */
  stageOrDeliver() {
    if (this.state === 'staged' && this.near(G07.truck, 6)) {
      const r = this.machine.deliver({ atExit: true, contractId: 'G07 stub contract' });
      if (r.ok) this.paid.push(r.entitlement);
      return this.result('deliver', r);
    }
    if (this.state === 'contained') {
      if (!this.near(this.crate)) return this.result('stage', { ok: false, why: 'get to the crate' });
      this.sled.x = this.crate.x; this.sled.z = this.crate.z + 0.2;
      const r = this.machine.stage(this.sled, this.routeBlocked ? { ok: false, why: 'a fallen log blocks the cargo route' } : { ok: true });
      if (r.ok) this.sled.loaded = true;
      return this.result('stage', r);
    }
    return this.result('deliver', this.machine.deliver({ atExit: this.near(G07.truck, 6) }));
  }
  /** Haul the staged sled toward the truck along the route (the player drags it: follows you). */
  haul(dt) {
    if (!this.sled.loaded || this.state !== 'staged') return;
    const p = this.g.player.position, s = this.sled;
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d > 2.5 && d < 6) { const k = (d - 2.5) / d; s.x += (p.x - s.x) * k; s.z += (p.z - s.z) * k; this.crate.x = s.x; this.crate.z = s.z - 0.2; }
  }
  setGenerator(on) { this.generator.running = on; this.log('generator', { running: on }); }
  setRouteBlocked(on) { this.routeBlocked = on; this.log('route', { blocked: on }); }

  update(dt) {
    this.time += dt;
    this.routine(dt);
    this.haul(dt);
    const before = this.machine.trace.length;
    const r = this.machine.tick(dt, { resistance: this.generator.running ? 0.3 : 1.6 });   // no power: the restraint strains much harder
    for (const e of this.machine.trace.slice(before)) if (e.type === 'warning' || e.type === 'nonDeliverable') { this.log(e.type, { what: e.what ?? e.why, integrity: Math.round(this.machine.integrity), condition: Math.round(this.machine.condition) }); this.notify(`Warning: ${e.what ?? e.why}`); }
    if (r && !r.ok) this.result('escape', r);
    this.place();
  }
}

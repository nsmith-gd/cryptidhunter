import * as THREE from 'three';
import { g03Contour, G04 } from '../maps/gymScenes.js';

// Creature proxies for gyms G03 and G04 (GDD 15.2; task #108). Simple, deterministic stand-ins that
// test one behaviour each, separate from the real cryptid AI. They move only by their own speed
// (no teleporting), act only on valid signals, and report every decision to the gym trace.
//   ContourProxy     (G03, Gouger-like) walks the hill's contour on its own schedule, whatever
//                    the player does; it leaves footprints only while unseen.
//   TerritoryProxy   (G04, Hodag-like) holds a defended zone: entering the warning ring gets a
//                    warning (it rears and growls); pushing on, or into the core, gets a charge
//                    and a nonlethal hit; leaving makes it disengage and go home.
//   ScentProxy       (G04, Howler-like) follows only scent traces that exist in the world (blood
//                    from a bleeding wound, opened food); with no trace to follow it loses contact.

function body(scene, color, h = 1.8, name = 'gym-proxy') {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, h - 0.9, 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.y = h / 2; m.castShadow = true;
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.12), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eye.position.set(0, h * 0.82, -0.42);
  g.add(m, eye);
  g.name = name;
  scene.add(g);
  return g;
}

const ring = (scene, x, z, r, color) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r + 0.08, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.name = 'gym-debug-ring';
  scene.add(m);
  return m;
};

// ---- G03 ---------------------------------------------------------------------------------------
export class ContourProxy {
  static CFG = { omega: 0.045, phase: 0.3, stride: 2.4, seenRange: 22, seenCone: THREE.MathUtils.degToRad(45) };

  constructor({ scene, clues, trace, debug }) {
    this.clues = clues; this.trace = trace;
    this.mesh = body(scene, 0x7a6248, 1.4, 'gym-proxy-gouger');
    // Debug answer: the contour it keeps to.
    const pts = []; for (let i = 0; i <= 64; i++) { const p = g03Contour((i / 64) * Math.PI * 2); pts.push(new THREE.Vector3(p.x, 0.06, p.z)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffa040 }));
    line.name = 'gym-debug-contour'; scene.add(line); debug(line);
    this.time = 0; this.walked = 0; this.left = 0; this.seenFor = 0;
    this.pos = this.schedule(0);
    this.place();
  }

  /** Where the schedule puts it at time t: depends on time only, never on the player. */
  schedule(t) { return g03Contour(ContourProxy.CFG.phase + ContourProxy.CFG.omega * t); }

  place() { this.mesh.position.set(this.pos.x, 0, this.pos.z); }

  seenBy(player) {
    const dx = this.pos.x - player.position.x, dz = this.pos.z - player.position.z, d = Math.hypot(dx, dz);
    if (d > ContourProxy.CFG.seenRange) return false;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    return Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (d || 1)))) < ContourProxy.CFG.seenCone;
  }

  update(dt, { player }) {
    this.time += dt;
    const next = this.schedule(this.time);
    const step = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
    const heading = Math.atan2(next.x - this.pos.x, next.z - this.pos.z);
    this.pos = next; this.walked += step;
    this.mesh.rotation.y = heading + Math.PI;
    this.place();
    const seen = this.seenBy(player);
    if (seen && !this.wasSeen) this.trace('proxy', 'sighted', { x: +this.pos.x.toFixed(1), z: +this.pos.z.toFixed(1) });
    this.wasSeen = seen;
    if (this.walked - this.left >= ContourProxy.CFG.stride) {
      this.left = this.walked;
      if (seen) { this.trace('proxy', 'no-trace-while-seen', {}); return; }
      const c = this.clues.spawn('footprint', { cryptidId: 'gouger-proxy', position: { x: this.pos.x, y: 0, z: this.pos.z }, rotationY: heading,
        origin: { x: this.pos.x, z: this.pos.z }, data: { length: 0.3, width: 0.14 } });
      this.trace('proxy', 'trace-left', { clue: c.id, x: +this.pos.x.toFixed(1), z: +this.pos.z.toFixed(1) });
    }
  }
}

// ---- G04 ---------------------------------------------------------------------------------------
/** True if solid cover (axis-aligned boxes {x0,z0,x1,z1}) blocks the straight line from a to b (#141). */
export function sightBlocked(ax, az, bx, bz, boxes = []) {
  const dx = bx - ax, dz = bz - az;
  for (const b of boxes) {
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, d, lo, hi] of [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } continue; }
      let u = (lo - p) / d, v = (hi - p) / d; if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

export class TerritoryProxy {
  // loseSight: seconds out of sight mid-charge before it pulls up; search: seconds it waits before going home (#141).
  static CFG = { charge: 5, back: 2.5, warnHold: 4, contact: 1.3, damage: 12, hitCooldown: 4, disengageMargin: 4, loseSight: 1, search: 2, calm: 6, minLead: 2 };

  constructor({ scene, trace, debug, notify = () => {} }) {
    this.trace = trace; this.notify = notify;
    this.mesh = body(scene, 0x8a3a2a, 2.0, 'gym-proxy-territorial');
    debug(ring(scene, G04.home.x, G04.home.z, G04.warnR, 0xffd040));
    debug(ring(scene, G04.home.x, G04.home.z, G04.coreR, 0xff4030));
    this.pos = { ...G04.home };
    this.state = 'idle';
    this.warnTime = 0; this.lastHit = -99; this.time = 0;
    this.place();
  }

  place() { this.mesh.position.set(this.pos.x, 0, this.pos.z); }

  set(state, data = {}) {
    if (state === this.state) return;
    this.trace('territory', state, { from: this.state, ...data });
    this.state = state;
  }

  moveToward(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    const s = Math.min(d, speed * dt);
    if (d > 1e-6) { this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s; this.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI; }
    this.place();
    return d - s;
  }

  update(dt, { player, health }) {
    this.time += dt;
    const C = TerritoryProxy.CFG, p = player.position;
    const fromHome = Math.hypot(p.x - G04.home.x, p.z - G04.home.z);
    const toMe = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (this.state === 'idle' && fromHome < G04.warnR && this.time >= (this.calmUntil ?? 0)) {   // just back home: a few seconds' grace to leave (#141)
      this.warnTime = 0;
      this.set('warn', { playerFromHome: +fromHome.toFixed(3) });
      this.notify('A deep, rattling growl. Something big rears up ahead. This is its ground.');
    } else if (this.state === 'warn') {
      this.warnTime += dt;
      this.mesh.rotation.y = Math.atan2(p.x - this.pos.x, p.z - this.pos.z) + Math.PI;
      this.mesh.scale.y = 1 + 0.15 * Math.abs(Math.sin(this.time * 6));   // rearing
      if (fromHome > G04.warnR + 3) { this.mesh.scale.y = 1; this.set('idle', { why: 'warning heeded' }); }
      // Even running straight into the core gets the minimum warning before it charges.
      else if ((fromHome < G04.coreR && this.warnTime >= C.minLead) || this.warnTime > C.warnHold) { this.mesh.scale.y = 1; this.set('charge', { lead: +this.warnTime.toFixed(2), playerFromHome: +fromHome.toFixed(1) }); }
    } else if (this.state === 'charge') {
      // It charges at what it can see. Behind solid cover it runs on to where it last saw you; out of
      // sight for long enough, it pulls up (#141: breaking line of sight is an escape response).
      const seen = !sightBlocked(this.pos.x, this.pos.z, p.x, p.z, G04.hides);
      if (seen) { this.unseen = 0; this.lastSeen = { x: p.x, z: p.z }; } else this.unseen = (this.unseen ?? 0) + dt;
      const aim = seen ? p : (this.lastSeen ?? p);
      this.moveToward(aim.x, aim.z, C.charge, dt);
      if (this.unseen > C.loseSight) { this.searchTime = 0; this.set('lost-sight', { hiddenFor: +this.unseen.toFixed(2), playerFromHome: +fromHome.toFixed(1) }); this.notify('It pulls up, snorting and swinging its head. It has lost sight of you.'); return; }
      if (toMe < C.contact && this.time - this.lastHit > C.hitCooldown) {
        this.lastHit = this.time;
        const ev = health?.injure({ cause: 'territorial proxy', damage: C.damage });
        this.trace('territory', 'hit', { damage: ev?.damage ?? 0, healthAfter: ev?.healthAfter ?? null });
        this.set('disengage', { why: 'made its point' });
      } else if (fromHome > G04.warnR + C.disengageMargin) this.set('disengage', { why: 'intruder left' });
    } else if (this.state === 'lost-sight') {
      this.searchTime += dt;
      if (this.searchTime > C.search) this.set('disengage', { why: 'lost sight' });
    } else if (this.state === 'disengage') {
      if (this.moveToward(G04.home.x, G04.home.z, C.back, dt) < 0.05) { this.calmUntil = this.time + C.calm; this.set('idle', { why: 'home' }); }
    }
  }
}

export class ScentProxy {
  static CFG = { keen: 1.2, threshold: 0.08, speed: 3, contact: 1.2, damage: 8, hitCooldown: 5, giveUp: 6 };

  constructor({ scene, scent, trace }) {
    this.scent = scent; this.trace = trace;
    this.mesh = body(scene, 0x4a4a5a, 1.3, 'gym-proxy-scent');
    this.pos = { ...G04.den };
    this.state = 'resting';
    this.lost = 0; this.time = 0; this.lastHit = -99; this.followed = null;
    this.checked = new Set();
    this.place();
  }

  place() { this.mesh.position.set(this.pos.x, 0, this.pos.z); }

  set(state, data = {}) {
    if (state === this.state) return;
    this.trace('scent', state, { from: this.state, ...data });
    this.state = state;
  }

  moveToward(x, z, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    const s = Math.min(d, ScentProxy.CFG.speed * dt);
    if (d > 1e-6) { this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s; this.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI; }
    this.place();
    return d - s;
  }

  update(dt, { player, health }) {
    this.time += dt;
    const C = ScentProxy.CFG;
    // It works a trail: each trace is checked once (reached), then it goes on to the next strongest
    // one it can still smell. When no unchecked trace reaches it, it has lost contact.
    let smell = null;
    for (const t of this.scent?.traces ?? []) {
      if (this.checked.has(t.id)) continue;
      const level = this.scent.levelAt(t, this.pos.x, this.pos.z) * C.keen;
      if (level > (smell?.level ?? 0)) smell = { trace: t, level };
    }
    if (smell && Math.hypot(smell.trace.x - this.pos.x, smell.trace.z - this.pos.z) < 0.8) { this.checked.add(smell.trace.id); this.trace('scent', 'checked-trace', { trace: smell.trace.id }); }
    if (smell && smell.level > C.threshold) {
      if (this.followed !== smell.trace.id) {
        this.followed = smell.trace.id;
        this.trace('scent', 'acquired', { trace: smell.trace.id, kind: smell.trace.kind, level: +smell.level.toFixed(3) });
      }
      this.set('tracking', { trace: smell.trace.id });
      this.lost = 0;
      this.moveToward(smell.trace.x, smell.trace.z, dt);
    } else if (this.state === 'tracking') {
      this.set('lost-contact', { lastTrace: this.followed });
      this.followed = null;
    } else if (this.state === 'lost-contact') {
      if ((this.lost += dt) > C.giveUp) this.set('returning');
    } else if (this.state === 'returning') {
      if (this.moveToward(G04.den.x, G04.den.z, dt) < 0.05) this.set('resting');
    }
    const p = player.position;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < C.contact && this.time - this.lastHit > C.hitCooldown && this.state === 'tracking') {
      this.lastHit = this.time;
      const ev = health?.injure({ cause: 'scent proxy', damage: C.damage });
      this.trace('scent', 'hit', { damage: ev?.damage ?? 0 });
    }
  }
}

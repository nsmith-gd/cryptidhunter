import * as THREE from 'three';
import { HodagAudio } from './hodagAudio.js';

// The Hodag (L06, Rhinelander WI; GDD 1.5 L06, 5.4, 12.2 card 06; task #142): a territorial proxy.
// It doesn't hunt you. It defends a patch of ground and escalates through one readable sequence:
//
//   warn      you cross into its warning ring: it rears up, its back spines stand on end, its eyes
//             glow, and it growls (a rattling growl, captioned with a direction) every 1.6 s. Step back
//             out past the boundary and it settles. That's the "heed the warning" exit.
//   charge    you stay (4 s), or walk into its core (after at least 2 s of warning): a bellowing roar
//             and a fast straight charge (6.5 m/s, at most 2.2 s).
//   pursuit   if the charge misses, a short pursuit: faster than you walk (3.8), slower than you sprint
//             (6), for at most 6 s.
//   hit       contact: a heavy goring wound (serious bleeding, through health) and it has made its
//             point: it disengages.
//   disengage it turns home with a snort, then gives you a few seconds' grace before warning again.
//
// The boundary is absolute: the moment you're past it (the ring plus a 2 m buffer), a charge or
// pursuit ends, every time, and the Hodag itself never crosses it. Solid cover (boxes) breaks its line
// of sight: unseen for 1 s mid-charge or pursuit, it pulls up, searches for 2 s and goes home.
// Every sound is captioned, every state change traced: trace(system 'territory', type, data).

export const HODAG = {
  warnHold: 4, minLead: 2, boundaryBuffer: 2,
  charge: 6.5, chargeTime: 2.2, pursuit: 3.8, pursuitTime: 6, back: 2.5,
  contact: 1.4, damage: 15, hitCooldown: 4,
  loseSight: 1, search: 2, calm: 6, growlEvery: 1.6, thudEvery: 0.32,
};

/** True if any box {x0,z0,x1,z1} blocks the straight line from a to b. */
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

/** Low-poly greybox Hodag: a squat horned body, a row of back spines that stand up when it warns. */
function buildMesh(scene) {
  const g = new THREE.Group(); g.name = 'hodag';
  const hide = new THREE.MeshStandardMaterial({ color: 0x2c3322, roughness: 0.85, flatShading: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0x000000, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.3), hide); body.position.y = 0.85; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.9), hide); head.position.set(0, 1.0, -1.45);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.7), bone); jaw.position.set(0, 0.62, -1.6);
  const horns = [-0.32, 0.32].map((x) => { const h = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6, 5), bone); h.position.set(x, 1.5, -1.35); h.rotation.x = -0.5; return h; });
  const eyes = [-0.25, 0.25].map((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMat); e.position.set(x, 1.12, -1.91); return e; });
  const legs = [[-0.5, -0.8], [0.5, -0.8], [-0.5, 0.8], [0.5, 0.8]].map(([x, z]) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.32), hide); l.position.set(x, 0.25, z); return l; });
  const spines = [];
  for (let i = 0; i < 7; i++) {
    const pivot = new THREE.Group(); pivot.position.set(0, 1.3, -0.9 + i * 0.36);
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55 - Math.abs(i - 3) * 0.05, 4), bone); s.position.y = 0.25; pivot.add(s);
    pivot.rotation.x = 1.2;           // laid flat along its back while calm
    spines.push(pivot);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 5), hide); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.8, 1.75);
  const rig = new THREE.Group();     // the rearing pivot (at the hind legs)
  rig.add(body, head, jaw, ...horns, ...eyes, ...legs, ...spines, tail);
  g.add(rig);
  scene.add(g);
  return { group: g, rig, spines, eyeMat };
}

export class HodagProxy {
  static CFG = HODAG;   // its fastest speed is CFG.charge (the gyms' no-teleport check reads it)
  /**
   * territory: { home: {x,z}, warnR, coreR, boundaryR? }. cover: boxes that block its sight.
   * captions: { say(text, at) } (optional). trace(system, type, data). notify(text).
   */
  constructor({ scene = null, territory, cover = [], trace = () => {}, notify = () => {}, captions = null, audio = null, cfg = {} }) {
    this.C = { ...HODAG, ...cfg };
    this.T = { ...territory, boundaryR: territory.boundaryR ?? territory.warnR + this.C.boundaryBuffer };
    Object.assign(this, { cover, traceFn: trace, notify, captions });
    this.audio = audio ?? new HodagAudio();
    this.pos = { ...territory.home };
    this.heading = 0;
    this.state = 'idle';
    this.time = 0; this.stateTime = 0; this.lastHit = -99; this.calmUntil = 0; this.unseen = 0; this.lastSeen = null;
    this.nextGrowl = 0; this.nextThud = 0;
    this.sounds = this.audio.log;       // every sound it made, for tests and the gym trace
    this.rig = scene ? buildMesh(scene) : null;
    this.mesh = this.rig?.group ?? null;
    this.place();
  }

  trace(type, data = {}) { this.traceFn('territory', type, data); }

  set(state, data = {}) {
    if (state === this.state) return;
    this.trace(state, { from: this.state, ...data });
    this.state = state; this.stateTime = 0;
  }

  fromHome(p) { return Math.hypot(p.x - this.T.home.x, p.z - this.T.home.z); }

  /** Make a sound: play it (panned toward where it is) and caption it, with a direction. */
  sound(kind, player, caption) {
    const p = player.position, dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz);
    const world = Math.atan2(dx, -dz), rel = Math.atan2(Math.sin(world + player.yaw), Math.cos(world + player.yaw));
    this.audio.play(kind, { pan: Math.sin(rel), distance: d, t: this.time });
    if (caption) this.captions?.say?.(caption, { x: this.pos.x, z: this.pos.z }, 3);
  }

  place() {
    if (!this.mesh) return;
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const warn = this.state === 'warn', angry = warn || this.state === 'charge' || this.state === 'pursuit';
    const k = 1 - Math.exp(-8 * (this.dtLast ?? 0.016));
    for (const s of this.rig.spines) s.rotation.x += ((angry ? 0.05 : 1.2) - s.rotation.x) * k;           // spines up
    this.rig.rig.rotation.x += ((warn ? -0.32 - 0.06 * Math.sin(this.time * 7) : 0) - this.rig.rig.rotation.x) * k;   // rearing
    this.rig.eyeMat.emissive.setHex(angry ? 0xff3010 : 0x000000);
  }

  /** Turn to face (x, z). */
  face(x, z) { this.heading = Math.atan2(-(x - this.pos.x), -(z - this.pos.z)); }

  /** Move toward (x, z) at speed, never past its own boundary. Returns the distance left. */
  moveToward(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    const s = Math.min(d, speed * dt);
    if (d > 1e-6) {
      let nx = this.pos.x + (dx / d) * s, nz = this.pos.z + (dz / d) * s;
      const hx = nx - this.T.home.x, hz = nz - this.T.home.z, r = Math.hypot(hx, hz), lim = this.T.boundaryR - 0.5;
      if (r > lim) { nx = this.T.home.x + hx / r * lim; nz = this.T.home.z + hz / r * lim; }
      this.pos.x = nx; this.pos.z = nz; this.face(x, z);
    }
    return d - s;
  }

  canSee(p) { return !sightBlocked(this.pos.x, this.pos.z, p.x, p.z, this.cover); }

  update(dt, { player, health }) {
    this.time += dt; this.stateTime += dt; this.dtLast = dt;
    const C = this.C, T = this.T, p = player.position;
    const fromHome = this.fromHome(p), toMe = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const outside = fromHome > T.boundaryR;
    switch (this.state) {
      case 'idle':
        if (fromHome < T.warnR && this.time >= this.calmUntil) {
          this.set('warn', { playerFromHome: +fromHome.toFixed(3) });
          this.notify('A rattling growl. Something low and horned rears up ahead, spines on end. This is its ground: back off past the stumps.');
          this.nextGrowl = 0;
        }
        break;
      case 'warn':
        this.face(p.x, p.z);
        if (this.time >= this.nextGrowl) { this.nextGrowl = this.time + C.growlEvery; this.sound('growl', player, 'A deep, rattling growl'); }
        if (outside) this.set('idle', { why: 'warning heeded', lead: +this.stateTime.toFixed(2) });
        else if ((fromHome < T.coreR && this.stateTime >= C.minLead) || this.stateTime > C.warnHold) {
          this.set('charge', { lead: +this.stateTime.toFixed(2), playerFromHome: +fromHome.toFixed(1) });
          this.sound('roar', player, 'A bellowing roar: it charges!');
          this.unseen = 0; this.lastSeen = { x: p.x, z: p.z };
        }
        break;
      case 'charge':
      case 'pursuit': {
        if (outside) { this.disengage(player, 'left territory', { playerFromHome: +fromHome.toFixed(2) }); break; }
        const seen = this.canSee(p);
        if (seen) { this.unseen = 0; this.lastSeen = { x: p.x, z: p.z }; } else this.unseen += dt;
        if (this.unseen > C.loseSight) { this.set('lost-sight', { hiddenFor: +this.unseen.toFixed(2), playerFromHome: +fromHome.toFixed(1) }); this.notify('It pulls up, snorting and swinging its head. It has lost sight of you.'); break; }
        const aim = seen ? p : this.lastSeen;
        this.moveToward(aim.x, aim.z, this.state === 'charge' ? C.charge : C.pursuit, dt);
        if (this.time >= this.nextThud) { this.nextThud = this.time + C.thudEvery * (this.state === 'charge' ? 1 : 1.5); this.sound('thud', player, null); }
        if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < C.contact && this.time - this.lastHit > C.hitCooldown) {
          this.lastHit = this.time;
          const ev = health?.injure({ cause: 'Hodag', damage: C.damage, wound: 'bleeding', severity: 'heavy' });
          this.trace('hit', { damage: ev?.damage ?? 0, healthAfter: ev?.healthAfter ?? null, during: this.state });
          this.notify('It slams into you, horns first. You\'re bleeding badly: get clear and bandage (B).');
          this.disengage(player, 'made its point');
        } else if (this.state === 'charge' && this.stateTime > C.chargeTime) this.set('pursuit', { playerFromHome: +fromHome.toFixed(1) });
        else if (this.state === 'pursuit' && this.stateTime > C.pursuitTime) this.disengage(player, 'gave up');
        break;
      }
      case 'lost-sight':
        if (this.stateTime > C.search) this.disengage(player, 'lost sight');
        break;
      case 'disengage':
        if (this.moveToward(T.home.x, T.home.z, C.back, dt) < 0.05) { this.calmUntil = this.time + C.calm; this.set('idle', { why: 'home' }); }
        break;
    }
    this.place();
    return toMe;
  }

  disengage(player, why, data = {}) {
    this.set('disengage', { why, ...data });
    this.sound('snort', player, 'A heavy snort. It turns away.');
  }
}

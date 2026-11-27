import * as THREE from 'three';

// JERSEY DEVIL (Level 9, L0 greybox proxy, #147; GDD 5.4 row 09, 5.3 visual channel, 8.1-8.2).
// An aerial, sight-dominant patrol over the Pine Barrens. Lore first: a winged, hoofed thing with a
// shriek, seen over the pines at night. Rules this teaches:
//   1. It can't see through the pine canopy or through rock. Under the trees you're hidden.
//   2. Open sky is exposure: clearings, the sand road's gaps, and above all light (a torch, a fire).
//      Movement in the open is seen further than stillness; light is seen furthest of all.
//   3. Every swoop is signalled: it stops and hovers over you, shrieks, its eyes flare, then it dives
//      at where you were. Get under the canopy (or behind rock) in that moment and it misses.
//   4. After a swoop it perches on a dead pine for a few seconds, low and still: the window to fire
//      a tracking tag (optional research objective, GDD 8.2 tagging; tagged is not captured).
// States: patrol -> investigate (circling a sighting) -> signal (hover, telegraph) -> swoop (dive)
//         -> climb -> perch (tag window) -> patrol. It never lands on you and never chases under cover.

export const JD = {
  altitude: 24,            // patrol height (m) above the pines
  patrolSpeed: 9,
  circleRadius: 14,        // circling a sighting
  sight: { still: 22, moving: 55, light: 140, fire: 120 },   // how far it sees you in the open (m)
  movingSpeed: 1.6,        // m/s: faster than this in the open counts as motion
  gain: 0.6,               // awareness per second at full visibility
  decay: 0.25,
  signalTime: 2.6,         // seconds of telegraph before a dive
  hoverHeight: 14,         // it drops to this height to signal
  diveSpeed: 24,
  hitRadius: 2.4,          // metres from the dive point that still hits (if you're still exposed)
  damage: 16,
  cooldown: 16,            // seconds after a swoop before it can signal again
  perchTime: 7,            // the tag window
  tagRange: 30,
};

export class JerseyDevil {
  /**
   * map: { coverAt(x, z) -> 0..1, rockBlocks(a, b) -> bool, perches: [{x, y, z}], nest, clearings, bounds }.
   * lights(): exposed light sources [{ x, z, kind: 'fire' }] (your fires). onHit(injury), onEvent(type, data).
   */
  constructor({ scene, player, flashlight, map, lights = () => [], onHit = () => {}, onEvent = () => {}, rand = Math.random }) {
    this.player = player; this.flashlight = flashlight; this.map = map; this.lights = lights;
    this.onHit = onHit; this.onEvent = onEvent; this.rand = rand;
    this.name = 'Jersey Devil';
    this.mesh = buildDevil();
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(map.nest?.x ?? 0, JD.altitude, map.nest?.z ?? 0);
    this.vel = new THREE.Vector3();
    this.state = 'patrol';
    this.stateTime = 0;
    this.awareness = 0;
    this.cue = null;              // { x, z, kind } what it's investigating
    this.cooldown = 4;
    this.patrolPts = [...(map.clearings ?? []), map.nest].filter(Boolean);
    this.patrolIdx = 0;
    this.swoops = []; this.history = [];
    this.tagWindow = false;
    this.visible = 0;             // current visibility of the player (debug)
    this.t = 0;
  }

  setState(s, why = '') { this.history.push({ t: +this.t.toFixed(1), from: this.state, to: s, why }); if (this.history.length > 16) this.history.shift(); this.state = s; this.stateTime = 0; }

  /** Is the player exposed to the sky here (not under canopy, not behind rock from where it is)? */
  exposed(p = this.player.position) {
    if ((this.map.coverAt?.(p.x, p.z) ?? 0) >= 0.5) return false;
    const eye = new THREE.Vector3(p.x, (p.y ?? 0) + 1.5, p.z);
    return !this.map.rockBlocks?.(this.pos, eye);
  }

  /** How far it can see you right now (0 when hidden), from light and motion. */
  sightRange() {
    if (!this.exposed()) return 0;
    if (this.flashlight?.on) return JD.sight.light;
    const v = this.player.velocity, moving = v && Math.hypot(v.x, v.z) > JD.movingSpeed;
    return moving ? JD.sight.moving : JD.sight.still;
  }

  update(dt) {
    this.t += dt; this.stateTime += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.player.position;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z, (p.y ?? 0) - this.pos.y);
    const range = this.sightRange();
    this.visible = range > 0 && d < range ? 1 - d / range : 0;
    if (this.visible > 0) { this.awareness = Math.min(1, this.awareness + JD.gain * dt * (0.4 + this.visible)); this.cue = { x: p.x, z: p.z, kind: this.flashlight?.on ? 'light' : 'motion' }; }
    else this.awareness = Math.max(0, this.awareness - JD.decay * dt);
    // Your exposed fires draw it too (warmth vs concealment), but it only swoops at people.
    if (!this.cue && this.state === 'patrol') {
      const f = this.lights().find((l) => (this.map.coverAt?.(l.x, l.z) ?? 0) < 0.5 && Math.hypot(l.x - this.pos.x, l.z - this.pos.z) < JD.sight.fire);
      if (f) this.cue = { x: f.x, z: f.z, kind: 'fire' };
    }

    switch (this.state) {
      case 'patrol': {
        const t = this.patrolPts[this.patrolIdx % this.patrolPts.length];
        if (this.fly(t.x, JD.altitude, t.z, JD.patrolSpeed, dt) < 6) this.patrolIdx++;
        if (this.cue) this.setState('investigate', this.cue.kind === 'fire' ? 'saw a fire' : `saw ${this.cue.kind} in the open`);
        break;
      }
      case 'investigate': {
        const a = this.t * 0.6, c = this.cue;
        this.fly(c.x + Math.cos(a) * JD.circleRadius, JD.altitude - 4, c.z + Math.sin(a) * JD.circleRadius, JD.patrolSpeed, dt);
        if (this.awareness >= 1 && this.cooldown <= 0 && this.visible > 0) {
          this.target = new THREE.Vector3(p.x, p.y ?? 0, p.z);
          this.setState('signal', 'found you');
          this.onEvent('signal', { x: p.x, z: p.z });
        } else if (this.stateTime > 14 && this.awareness < 0.2) { this.cue = null; this.setState('patrol', 'lost interest'); }
        break;
      }
      case 'signal': {
        // Telegraph: hang over you, lower, eyes flaring, shrieking. It keeps tracking you while you're exposed.
        if (this.visible > 0) this.target.set(p.x, p.y ?? 0, p.z);
        this.fly(this.target.x, JD.hoverHeight, this.target.z + 6, JD.patrolSpeed, dt);
        if (this.stateTime >= JD.signalTime) {
          if (!this.exposed()) { this.setState('climb', 'lost you under cover'); this.swoops.push({ t: this.t, result: 'aborted' }); this.onEvent('swoop-aborted', {}); }
          else { this.setState('swoop', 'diving'); this.onEvent('swoop', { x: this.target.x, z: this.target.z }); }
        }
        break;
      }
      case 'swoop': {
        const left = this.fly(this.target.x, (this.target.y ?? 0) + 1.2, this.target.z, JD.diveSpeed, dt);
        if (left < 1.2) {
          const hit = Math.hypot(p.x - this.target.x, p.z - this.target.z) < JD.hitRadius && this.exposed();
          this.swoops.push({ t: this.t, result: hit ? 'hit' : 'miss' });
          if (hit) this.onHit({ damage: JD.damage, wound: 'bleeding', severity: 'light' });
          this.onEvent(hit ? 'swoop-hit' : 'swoop-miss', {});
          this.cooldown = JD.cooldown; this.awareness = 0.4; this.cue = null;
          this.setState('climb', hit ? 'raked you' : 'missed');
        }
        break;
      }
      case 'climb': {
        if (this.fly(this.pos.x, JD.altitude, this.pos.z - 3, JD.patrolSpeed, dt) < 3 || this.stateTime > 3) {
          // Perch on the nearest dead pine: low and still for a moment (the tag window).
          const per = [...(this.map.perches ?? [])].sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z))[0];
          if (per) { this.perch = per; this.setState('toPerch', 'going to roost'); } else this.setState('patrol', 'back on patrol');
        }
        break;
      }
      case 'toPerch': {
        if (this.fly(this.perch.x, this.perch.y, this.perch.z, JD.patrolSpeed * 1.3, dt) < 1) { this.setState('perch', 'perched'); this.tagWindow = true; this.onEvent('perch', { ...this.perch }); }
        break;
      }
      case 'perch': {
        this.vel.set(0, 0, 0);
        if (this.stateTime > JD.perchTime) { this.tagWindow = false; this.setState('patrol', 'took off'); }
        break;
      }
    }
    this.sync(dt);
  }

  /** Steer toward a point; returns the distance left. */
  fly(x, y, z, speed, dt) {
    const to = new THREE.Vector3(x - this.pos.x, y - this.pos.y, z - this.pos.z), d = to.length();
    if (d > 1e-3) { to.multiplyScalar(Math.min(speed * dt, d) / d); this.pos.add(to); this.vel.copy(to).divideScalar(dt || 1); }
    return Math.max(0, d - speed * dt);
  }

  /** Fire a tracking tag from the player's position (GDD 8.2). Only during the perch window, in range, clear line. */
  tryTag(from) {
    if (!this.tagWindow) return { ok: false, why: 'No opening: it has to be perched and still' };
    const d = from.distanceTo(this.pos);
    if (d > JD.tagRange) return { ok: false, why: `Too far (${Math.round(d)} m): get within ${JD.tagRange} m` };
    if (this.map.rockBlocks?.(from, this.pos)) return { ok: false, why: 'No clear shot' };
    this.tagged = true; this.tagWindow = false;
    this.onEvent('tagged', { distance: d });
    this.setState('patrol', 'tagged: bolted off the perch');
    return { ok: true, distance: d };
  }

  sync(dt) {
    const m = this.mesh;
    m.position.copy(this.pos);
    const v = this.vel; if (Math.hypot(v.x, v.z) > 0.3) m.rotation.y = Math.atan2(-v.x, -v.z);
    const flap = this.state === 'perch' ? 0.1 : this.state === 'swoop' ? 0.05 : Math.sin(this.t * (this.state === 'signal' ? 14 : 6));
    m.userData.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.2 + flap * 0.6); });
    // Eyes flare during the telegraph and the dive.
    const hot = this.state === 'signal' || this.state === 'swoop';
    m.userData.eyes.material.color.setHex(hot ? 0xff2a10 : 0x7a1608);
    m.userData.eyeGlow.intensity = hot ? 6 + 4 * Math.sin(this.t * 20) : 0.6;
  }

  /** Photo subject (for the camera). */
  subject() { return { name: this.name, object3d: this.mesh, radius: 1.1, center: this.pos.clone(), height: 1.6 }; }
}

/** Greybox body: horse-like head, long neck and tail, two bat wings, red eyes (with a light for the telegraph). */
function buildDevil() {
  const g = new THREE.Group(); g.name = 'jersey-devil';
  const m = (c, e = 0x000000) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: e, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.4), m(0x2a1f1c, 0x0c0606)); g.add(body);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.8), m(0x2a1f1c)); neck.position.set(0, 0.3, -0.9); neck.rotation.x = 0.5; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.6), m(0x2a1f1c)); head.position.set(0, 0.55, -1.35); g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.6), m(0x1c1514)); tail.position.set(0, -0.1, 1.4); tail.rotation.x = -0.3; g.add(tail);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x7a1608 })); eyes.position.set(0, 0.62, -1.62); g.add(eyes);
  const eyeGlow = new THREE.PointLight(0xff3010, 0.6, 18); eyeGlow.position.set(0, 0.6, -1.8); g.add(eyeGlow);
  const wings = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group(); w.position.set(0.3 * s, 0.2, -0.1);
    const membrane = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 2.6 * s, 0.2, -0.2, 2.2 * s, 0, 0.8, 0, 0, 0.6], 3)).setIndex([0, 1, 2, 0, 2, 3]),
      new THREE.MeshStandardMaterial({ color: 0x3a2622, side: THREE.DoubleSide, roughness: 0.9 }));
    w.add(membrane); g.add(w); wings.push(w);
  }
  g.userData = { wings, eyes, eyeGlow, body };
  return g;
}

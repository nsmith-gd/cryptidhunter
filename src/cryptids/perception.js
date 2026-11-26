import * as THREE from 'three';

// Cryptid senses (L1). Each tick turns what the cryptid can hear and see into an
// awareness meter (0..1). Hearing reads the player's noise and distance; sight reads a
// view cone, the scene's light level, crouching and whether the flashlight is on.
// The behaviour layer reads `detected`, `awareness`, `heard`, `seen` and the last-known spots.
//
// Tuning lives on the cryptid's profile (see profiles.js `senses`).
//
// GDD 5.3 (#86): every sensed cue is also kept as a STIMULUS RECORD in a short memory:
//   { channel: 'acoustic'|'visual'|'light'|'scent'|'call', source, x, z, uncertainty (m),
//     intensity, t, expiry, confidence }
// Confidence fades to zero at expiry; sounds carry direction uncertainty that grows with distance.
// On top of the awareness meter sits the AWARENESS STAGE ladder:
//   unaware -> suspicious -> investigating -> identified -> engaged -> lost -> reset -> unaware
// (updateStage, called after the brain has acted, since 'investigating'/'engaged' are what it's doing).
export const DEFAULT_SENSES = Object.freeze({
  hearing: 1.0,            // multiplies how far the player's noise carries to this cryptid
  hearThreshold: 0.05,     // quieter than this is ignored
  sightRange: 30,          // metres it can see a fully visible player
  viewAngle: 60,           // half-angle of the view cone, degrees
  peripheral: 4,           // metres: within this it notices you even outside the cone (if visible)
  // Player visibility (multiplies sightRange):
  darkVisibility: 0.22,    // standing in the dark, light off
  crouchFactor: 0.6,       // crouching shrinks your silhouette
  flashlightVisibility: 1.0, // with the flashlight on you're lit up
  beamNotice: 0.6,         // shining the beam on it is noticed from any direction (stimulus strength)
  // Awareness meter:
  gain: 3.0,               // awareness per second per unit stimulus
  decay: 0.25,             // per second when nothing is sensed
  detectAt: 1.0,           // awareness at which it has detected the player
});

export const STAGES = Object.freeze(['unaware', 'suspicious', 'investigating', 'identified', 'engaged', 'lost', 'reset']);
export const MEMORY = Object.freeze({
  size: 16,                       // records kept (oldest/weakest dropped)
  merge: 3,                       // metres: a new cue this close to a record of the same channel+source refreshes it
  ttl: { acoustic: 20, visual: 30, light: 15, scent: 60, call: 25 },   // seconds a record lasts
  lostFor: 3,                     // seconds without the player before 'lost' (after identified/engaged)
  resetFor: 2,                    // seconds spent in 'reset' before 'unaware'
});
const ENGAGED_STATES = new Set(['aggress', 'warn', 'flee', 'shadow']);

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Perception {
  /**
   * @param {object} o { profile, senses: { player, flashlight, camera, colliders, lightLevel } }
   */
  constructor(profile, { player, flashlight = null, camera = null, colliders = [], lightLevel = 0 }) {
    this.cfg = { ...DEFAULT_SENSES, ...(profile.senses ?? {}) };
    this.eyeHeight = (profile.height ?? 2) * 0.9;
    this.player = player;
    this.flashlight = flashlight;
    this.camera = camera;
    this.colliders = colliders;
    this.lightLevel = lightLevel;  // ambient light 0 (black) .. 1 (daylight)
    this.awareness = 0;
    this.hearLevel = 0;
    this.sightLevel = 0;
    this.beamLevel = 0;
    this.heard = false;
    this.seen = false;
    this.detected = false;
    this.lastHeard = null;   // {x, z, t}
    this.lastSeen = null;
    this.time = 0;
    this.memory = [];        // stimulus records (see MEMORY)
    this.stage = 'unaware';
    this.stageSince = 0;
    this.stageLog = [];      // [{ t, from, to }] newest last
    this.lastPlayerCue = -99;
  }

  // ---- stimulus memory ----------------------------------------------------------------------
  /** Remember a cue. Refreshes a nearby record of the same channel and source instead of piling up. */
  remember(channel, source, x, z, intensity, uncertainty = 1) {
    const ttl = MEMORY.ttl[channel] ?? 20;
    const r = this.memory.find((m) => m.channel === channel && m.source === source && Math.hypot(m.x - x, m.z - z) < MEMORY.merge + m.uncertainty);
    if (r) {
      // Blend toward the new estimate, weighted by how sure each one is.
      const w = intensity / (intensity + r.intensity * r.confidence + 1e-6);
      r.x += (x - r.x) * w; r.z += (z - r.z) * w;
      r.uncertainty = Math.min(r.uncertainty, uncertainty) * 0.7 + uncertainty * 0.3;
      r.intensity = Math.max(intensity, r.intensity * 0.8);
      r.t = this.time; r.expiry = this.time + ttl; r.confidence = 1; r.count = (r.count ?? 1) + 1;
      return r;
    }
    const rec = { channel, source, x, z, uncertainty, intensity, t: this.time, expiry: this.time + ttl, confidence: 1, count: 1 };
    this.memory.push(rec);
    if (this.memory.length > MEMORY.size) {
      this.memory.sort((a, b) => b.confidence * b.intensity - a.confidence * a.intensity);
      this.memory.length = MEMORY.size;
    }
    return rec;
  }

  forgetExpired() {
    for (const m of this.memory) m.confidence = Math.max(0, (m.expiry - this.time) / (m.expiry - m.t || 1));
    this.memory = this.memory.filter((m) => m.confidence > 0);
  }

  /** Strongest remembered cue (optionally of one source / channel): confidence × intensity. */
  recall({ source = null, channel = null } = {}) {
    let best = null, bestS = 0;
    for (const m of this.memory) {
      if ((source && m.source !== source) || (channel && m.channel !== channel)) continue;
      const s = m.confidence * (0.4 + m.intensity);
      if (s > bestS) { best = m; bestS = s; }
    }
    return best;
  }

  /** Last-known position of the player: what it actually sensed, with its uncertainty. */
  lastKnown() { return this.recall({ source: 'player' }); }

  // ---- awareness stages ---------------------------------------------------------------------
  setStage(stage) {
    if (stage === this.stage) return;
    this.stageLog.push({ t: +this.time.toFixed(2), from: this.stage, to: stage });
    if (this.stageLog.length > 12) this.stageLog.shift();
    this.stage = stage;
    this.stageSince = this.time;
  }

  /** Advance the stage ladder given what the cryptid is doing now (its behaviour state). */
  updateStage(state) {
    const sensing = this.time - this.lastPlayerCue < 0.5;
    const memo = this.lastKnown();
    const was = this.stage, inStage = this.time - this.stageSince;
    if (this.detected) return this.setStage(ENGAGED_STATES.has(state) ? 'engaged' : 'identified');
    if (was === 'identified' || was === 'engaged') {
      if (ENGAGED_STATES.has(state) && sensing) return;                         // still on you
      if (this.time - this.lastPlayerCue >= MEMORY.lostFor || !ENGAGED_STATES.has(state)) return this.setStage('lost');
      return;
    }
    if (was === 'lost') {
      if (sensing && this.awareness > 0.3) return this.setStage('identified');
      if (state === 'investigate') return;                                       // checking the last-known spot
      if (!memo || memo.confidence < 0.15 || inStage > 20) return this.setStage('reset');
      return;
    }
    if (was === 'reset') { if (inStage >= MEMORY.resetFor) this.setStage('unaware'); return; }
    if (state === 'investigate' && (memo || this.lastHeard)) return this.setStage('investigating');
    if (this.awareness > 0.05 || sensing) return this.setStage('suspicious');
    if (was === 'investigating' || was === 'suspicious') return this.setStage(memo && memo.confidence > 0.3 ? 'suspicious' : 'unaware');
  }

  /** How visible the player is right now, as a multiplier on sightRange. */
  playerVisibility() {
    const c = this.cfg, p = this.player;
    const ambient = Math.min(1, c.darkVisibility + this.lightLevel);
    let v = this.flashlight?.on ? Math.max(ambient, c.flashlightVisibility) : ambient;
    if (p.crouching) v *= c.crouchFactor;
    return v;
  }

  update(dt, x, z, heading) {
    const c = this.cfg, p = this.player.position;
    this.time += dt;
    const dx = p.x - x, dz = p.z - z;
    const dist = Math.hypot(dx, dz);

    // Hearing: the player's noise at this spot, scaled by how keen its ears are.
    const noise = this.player.noise ?? 0, radius = (this.player.noiseRadius ?? 0) * c.hearing;
    this.hearLevel = radius > 0 ? Math.max(0, noise * (1 - dist / radius)) : 0;
    this.heard = this.hearLevel > c.hearThreshold;
    if (this.heard) {
      this.lastHeard = { x: p.x, z: p.z, t: this.time };
      // Sounds give a rough direction: the further and fainter, the less sure where.
      this.remember('acoustic', 'player', p.x, p.z, this.hearLevel, 1 + dist * 0.25 * (1 - this.hearLevel));
      this.lastPlayerCue = this.time;
    }

    // Sight: inside the view cone (or very close), within visibility-scaled range, clear line.
    const range = c.sightRange * this.playerVisibility();
    this.sightLevel = 0;
    if (dist < range) {
      const fx = -Math.sin(heading), fz = -Math.cos(heading);
      const cos = dist > 1e-3 ? (fx * dx + fz * dz) / dist : 1;
      const inCone = cos >= Math.cos(THREE.MathUtils.degToRad(c.viewAngle));
      if ((inCone || dist < c.peripheral) && this.clearLine(x, z, p)) this.sightLevel = 1 - dist / range;
    }

    // The beam itself: being lit up gets noticed whichever way it's facing.
    this.beamLevel = 0;
    if (this.flashlight?.on && this.camera && dist < 30) {
      const cam = this.camera.position;
      this.camera.getWorldDirection(_v);
      const to = new THREE.Vector3(x - cam.x, this.eyeHeight * 0.6 - cam.y, z - cam.z);
      if (_v.angleTo(to) < THREE.MathUtils.degToRad(22) && this.clearLine(x, z, p)) {
        this.beamLevel = c.beamNotice * (1 - dist / 30);
      }
    }
    this.seen = this.sightLevel > 0 || this.beamLevel > 0;
    if (this.seen) {
      this.lastSeen = { x: p.x, z: p.z, t: this.time };
      this.remember(this.sightLevel > 0 ? 'visual' : 'light', 'player', p.x, p.z, Math.max(this.sightLevel, this.beamLevel), 0.5);
      this.lastPlayerCue = this.time;
    }
    this.forgetExpired();

    const stimulus = Math.max(this.hearLevel, this.sightLevel, this.beamLevel);
    if (stimulus > 0) this.awareness = Math.min(1, this.awareness + stimulus * c.gain * dt);
    else this.awareness = Math.max(0, this.awareness - c.decay * dt);
    // Once detected it stays detected until awareness drains to half.
    this.detected = this.detected ? this.awareness > 0.5 : this.awareness >= c.detectAt;
    return this;
  }

  /** Is there a clear line from the cryptid's eyes to the player's chest? */
  clearLine(x, z, p) {
    const from = _v.set(x, this.eyeHeight, z);
    const to = new THREE.Vector3(p.x, p.y + (this.player.height ?? 1.8) * 0.7, p.z);
    const dir = to.clone().sub(from);
    const len = dir.length();
    _ray.set(from.clone(), dir.normalize());
    for (const b of this.colliders) {
      if (b.containsPoint(from)) continue;      // standing against it
      if (_ray.intersectBox(b, _hit) && _hit.distanceTo(from) < len - 0.3) return false;
    }
    return true;
  }

  /** Forget the player (e.g. after losing them). */
  reset() { this.awareness = 0; this.detected = false; }
}

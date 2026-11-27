import * as THREE from 'three';
import { sel, seq, when, act, tier, Brain, OK, RUN, FAIL } from './brains/bt.js';

// MOTHMAN — behaviour tree, lore first (Point Pleasant, 1966-67):
//  · A tall winged shape with glowing red eyes that watches from high places — treetops,
//    the old bridge — and is DRAWN TO LIGHTS (it was said to chase car headlights).
//  · A harbinger: it rarely touches anyone, but its presence brings dread, and it is seen
//    again and again, bolder each time.
//  · It can't be cornered: approach it, or catch it on film, and it bursts away into the dark,
//    to be seen somewhere else.
// Rules this teaches the player:
//  1. Your light brings it to you; darkness sends it back to its perch.
//  2. Don't hold your beam on it — that provokes a swoop (from level 3, one that can take you).
//  3. To photograph it, catch it perched and watching; then expect it to vanish and come back bolder.
export const MOTHMAN = {
  catchHits: 1,                      // if it ever reaches you, it takes you
  homeLevel: 2,                      // the swamp: the second hunting ground
  home: new THREE.Vector3(0, 0, -15),
  farRadius: 22, nearRadius: 4,      // orbit radius when ignoring / fully lured
  farHeight: 14, nearHeight: 3.5,    // orbit height when ignoring / fully lured
  orbitSpeed: 7,                     // metres per second along the circle
  lureRise: 0.12,                    // lure gained per second with the light on (~8s to full)
  lureFall: 0.15,                    // lure lost per second with the light off
  follow: 1.5,                       // how quickly it slides toward its target spot
  flySpeed: 9,                       // m/s between perches
};

// Per escalation level.
export const MOTHMAN_TIERS = {
  1: { swoop: false, stareToSwoop: 99, swoopLow: 4.0, perchAfter: 3, approachVanish: 6 },
  2: { swoop: true, stareToSwoop: 2.5, swoopLow: 3.2, perchAfter: 2.5, approachVanish: 7 },
  3: { swoop: true, stareToSwoop: 1.4, swoopLow: 1.3, perchAfter: 2, approachVanish: 9 },   // low enough to take you
};

export class Mothman {
  constructor(scene, player, flashlight, { camera = null, level = null, onEvent = null, perches = null, corridors = null } = {}) {
    this.name = 'Mothman';
    this.player = player;
    this.flashlight = flashlight;
    this.camera = camera;
    this.level = level ?? MOTHMAN.homeLevel;
    this.onEvent = onEvent;
    this.lure = 0;                   // 0 = ignoring you, 1 = circling right over you
    this.boldness = 0;               // grows with each sighting / vanish: perches closer, swoops sooner
    this.angle = 0;
    this.center = MOTHMAN.home.clone();
    this.state = 'circle';           // circle | perch | drawn | swoop | vanish
    this.stateTime = 0;
    this.stare = 0;                  // seconds your beam has been on it
    this.dark = 0;                   // seconds the light has been off
    this.photographed = false;
    this.perches = perches ?? this.makePerches();
    this.corridors = corridors;      // (#146) flight lines it travels when it isn't drawn to you: [[Vector3...]]
    this.leg = { line: 0, i: 0, dir: 1 };
    this.perch = null;
    this.vel = new THREE.Vector3();

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3440, emissive: 0x1a1020, roughness: 0.8 }),
    );
    // Two red eye dots so it reads in the dark.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    for (const x of [-0.25, 0.25]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), eyeMat);
      eye.position.set(x, 0.15, 0.72);
      this.mesh.add(eye);
    }
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.brain = this.buildBrain();
    this.update(0);
  }

  get T() { return MOTHMAN_TIERS[Math.min(3, Math.max(1, this.level))]; }
  emit(type, data = {}) { this.onEvent?.(type, { name: 'Mothman', ...data }); }
  setState(s) { if (s !== this.state) { this.state = s; this.stateTime = 0; } }

  // Treetop perches around its home (a map can supply real ones: bridge, dead snags).
  makePerches() {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4, r = 14 + (i % 3) * 5;
      out.push(new THREE.Vector3(MOTHMAN.home.x + Math.cos(a) * r, 9 + (i % 2) * 3, MOTHMAN.home.z + Math.sin(a) * r));
    }
    return out;
  }

  /** Is the player's flashlight beam on it? */
  beamOnMe() {
    if (!this.flashlight.on || !this.camera) return false;
    const to = this.mesh.position.clone().sub(this.camera.position);
    if (to.length() > 35) return false;
    return this.camera.getWorldDirection(new THREE.Vector3()).angleTo(to) < THREE.MathUtils.degToRad(18);
  }

  /** The camera caught it (hooked up by the game). */
  onPhotographed() { this.photographed = true; }

  buildBrain() {
    const m = this;
    const p = () => m.player.position;
    const flatDist = () => Math.hypot(m.mesh.position.x - p().x, m.mesh.position.z - p().z);
    const root = sel('Mothman',
      // Already committed.
      seq('Swooping', when('swooping', () => m.state === 'swoop'), act('dive past you', () => m.tickSwoop())),
      seq('Vanishing', when('vanishing', () => m.state === 'vanish'), act('burst away into the dark', () => m.tickVanish())),
      // It can't be cornered: get under it, or catch it on film, and it's gone.
      seq('Exposed', when('approached or photographed', () => m.photographed || (m.state === 'perch' && flatDist() < m.T.approachVanish)),
        act('vanish', () => m.startVanish(m.photographed ? 'photographed' : 'approached'))),
      // Holding your light on it provokes it.
      tier(2, seq('Provoked', when('beam held on it', () => m.T.swoop && m.lure > 0.6 && m.stare >= m.T.stareToSwoop - m.boldness * 0.4),
        act('swoop at the light', () => m.startSwoop()))),
      // Drawn to light.
      seq('Drawn to light', when('light on', () => m.flashlight.on), act('spiral in toward the light', () => m.tickDrawn())),
      // In the dark it settles on a perch and watches you.
      seq('Watching', when('dark for a while', () => m.dark >= m.T.perchAfter - m.boldness * 0.3 && m.lure < 0.3), act('perch and watch', () => m.tickPerch())),
      act('circle its haunt', () => m.tickCircle()),
    );
    return new Brain(root, { get level() { return m.level; } });
  }

  update(dt) {
    const M = MOTHMAN;
    this.stateTime += dt;
    this.dark = this.flashlight.on ? 0 : this.dark + dt;
    this.lure = THREE.MathUtils.clamp(this.lure + (this.flashlight.on ? M.lureRise * (1 + this.boldness * 0.5) : -M.lureFall) * dt, 0, 1);
    const beam = this.beamOnMe();
    this.stare = beam ? this.stare + dt : Math.max(0, this.stare - dt * 2);
    this.dt = dt;
    if (dt > 0) this.brain.tick(); else this.tickCircle();
    this.mesh.lookAt(this.player.position.x, this.player.position.y + 1.6, this.player.position.z);
  }

  // --- movement helpers ----------------------------------------------------------------------
  moveToward(target, speed) {
    const d = target.clone().sub(this.mesh.position);
    const len = d.length(), step = speed * this.dt;
    if (len <= step) { this.mesh.position.copy(target); return true; }
    this.mesh.position.addScaledVector(d, step / len);
    return false;
  }

  // Orbit: centre slides from home toward the player as the lure builds (the original L0 flight).
  orbit() {
    const M = MOTHMAN, p = this.player.position;
    const targetCenter = new THREE.Vector3().lerpVectors(M.home, new THREE.Vector3(p.x, 0, p.z), this.lure);
    this.center.lerp(targetCenter, 1 - Math.exp(-M.follow * this.dt));
    const radius = THREE.MathUtils.lerp(M.farRadius, M.nearRadius, this.lure);
    // Heights are above the ground you're standing on (deck, bridge), so circling never touches you:
    // only a level-3 swoop is meant to.
    const height = Math.max(0, p.y) + THREE.MathUtils.lerp(M.farHeight, M.nearHeight, this.lure);
    this.angle += (M.orbitSpeed / radius) * this.dt;
    const want = new THREE.Vector3(this.center.x + Math.cos(this.angle) * radius, height + Math.sin(this.angle * 2.3) * 0.6, this.center.z + Math.sin(this.angle) * radius);
    // Ease toward the orbit point (so leaving a perch is a flight, not a jump); spawn right on it.
    if (!this.placed) { this.mesh.position.copy(want); this.placed = true; }
    else this.mesh.position.lerp(want, 1 - Math.exp(-4 * this.dt));
  }

  tickCircle() {
    this.setState('circle');
    if (this.corridors?.length && this.lure < 0.3) this.patrol(); else this.orbit();
    return RUN;
  }

  /** Travel a corridor (#146): fly waypoint to waypoint along it, turn at the ends, then switch lines. */
  patrol() {
    const L = this.leg, line = this.corridors[L.line % this.corridors.length];
    const target = line[L.i];
    if (!this.placed) { this.mesh.position.copy(target); this.placed = true; }
    if (this.moveToward(target, MOTHMAN.flySpeed * 0.7)) {
      L.i += L.dir;
      if (L.i >= line.length || L.i < 0) {
        L.dir = -L.dir; L.i += 2 * L.dir;
        if (L.dir > 0) { L.line = (L.line + 1) % this.corridors.length; L.i = 0; }
      }
    }
  }
  tickDrawn() { this.setState('drawn'); this.perch = null; this.orbit(); return RUN; }

  tickPerch() {
    if (this.state !== 'perch' || !this.perch) {
      this.setState('perch');
      // The bolder it gets, the closer to you it chooses to sit.
      const p = this.player.position;
      const scored = this.perches.map((v) => ({ v, d: Math.hypot(v.x - p.x, v.z - p.z) }));
      const wantDist = Math.max(10, 28 - this.boldness * 6);
      scored.sort((a, b) => Math.abs(a.d - wantDist) - Math.abs(b.d - wantDist));
      this.perch = scored[0].v;
    }
    if (this.moveToward(this.perch, MOTHMAN.flySpeed) && !this.perchedAt) { this.perchedAt = performance.now(); this.emit('perched'); }
    return RUN;
  }

  startSwoop() {
    this.setState('swoop');
    const p = this.player.position;
    // A low pass straight over your head and out the other side.
    const from = this.mesh.position.clone();
    const over = new THREE.Vector3(p.x, Math.max(0, p.y) + this.T.swoopLow + 1.0, p.z);
    const dir = over.clone().sub(from).setY(0).normalize();
    this.swoop = { from, over, out: over.clone().addScaledVector(dir, 25).setY(14), leg: 0 };
    this.stare = 0;
    this.emit('screech');
    return RUN;
  }

  tickSwoop() {
    const s = this.swoop;
    if (s.leg === 0 && this.moveToward(s.over, 16)) { s.leg = 1; this.emit('swoop-pass', { low: this.T.swoopLow }); }
    else if (s.leg === 1 && this.moveToward(s.out, 14)) { this.boldness = Math.min(2, this.boldness + 0.5); this.lure = 0.3; this.setState('circle'); return OK; }
    return RUN;
  }

  startVanish(why) {
    this.setState('vanish');
    this.photographed = false;
    this.perchedAt = null;
    this.boldness = Math.min(2, this.boldness + 0.5);
    // Pick a different perch, well away from where you are now.
    const p = this.player.position;
    const far = this.perches.filter((v) => v !== this.perch).sort((a, b) => Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(a.x - p.x, a.z - p.z));
    this.perch = far[0] ?? this.perch;
    this.vanish = { up: this.mesh.position.clone().setY(this.mesh.position.y + 18), leg: 0 };
    this.lure = 0;
    this.emit('vanish', { why });
    return RUN;
  }

  tickVanish() {
    const v = this.vanish;
    if (v.leg === 0 && this.moveToward(v.up, 22)) v.leg = 1;
    else if (v.leg === 1 && this.moveToward(this.perch, 14)) { this.setState('perch'); this.emit('perched'); return OK; }
    return RUN;
  }

  get pathText() { return this.brain.pathText; }

  distanceToPlayer() {
    return this.mesh.position.distanceTo(new THREE.Vector3(this.player.position.x, this.player.position.y + 1.6, this.player.position.z));
  }
}

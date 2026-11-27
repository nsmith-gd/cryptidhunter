import * as THREE from 'three';
import { NavAgent } from './navAgent.js';
import { DEFAULT_PROFILE } from './profiles.js';
import { Perception } from './perception.js';
import { brainFactory, buildModel } from './species.js';
import './catalog.js';   // registers the shared brains, body models and species (#86)
import { stream } from '../core/rng.js';
import { groundAt } from '../maps/ground.js';

// Brains and bodies come from the species registry (species.js): a profile names its brain
// ('utility' by default, 'bigfoot' for its signature tree) and its body family ('capsule', 'quadruped', ...).

// Body tint per state (greybox readability); roam/investigate keep the cryptid's own colour.
const STATE_TINT = {
  warn: new THREE.Color(0xd0702a),
  shadow: new THREE.Color(0x5a4a3a),
  stalk: new THREE.Color(0x4a3e34),
  observe: new THREE.Color(0xb08a3a),
  flee: new THREE.Color(0xc0392b),
  aggress: new THREE.Color(0xe0581a),
};
const _v = new THREE.Vector3();

// Shared cryptid brain. With senses (L1) it runs a behaviour state machine -
// Roam / Investigate / Observe / Flee / Aggress - driven by what it hears and sees
// (perception.js) and tuned per cryptid by the profile's `behavior` block (profiles.js).
// Without senses it falls back to the L0 rules: roam, eat bait, flee at a fixed distance.
export class CryptidAI {
  /**
   * @param {object} o { scene, grid, profile, x, z, getPlayerPosition: () => THREE.Vector3, rand,
   *   lures: { lures(): {x, z, gone, claimedBy}[], consume(lure), eatTime } (optional),
   *   senses: { player, flashlight, camera, colliders, lightLevel } (optional: enables hearing + sight),
   *   calls: audio lures playing a call (optional; only calls for this cryptid's species count) }
   */
  constructor({ scene, grid, profile = DEFAULT_PROFILE, x = 0, z = 0, getPlayerPosition, rand = stream(`cryptid:${profile.id}`), lures = null, senses = null, calls = null, level = null, rocks = null, onEvent = null }) {
    this.level = level ?? profile.homeLevel ?? 1;   // escalation level (1 forgiving .. 3 relentless)
    this.rocks = rocks;
    this.onEvent = onEvent;      // (type, data) for the game: 'whoop', 'rock', 'rock-hit', 'roar', 'charge'
    this.agitation = 0;          // 0 calm .. 1 furious; rises each time it's provoked, slowly calms
    this.lastWarn = -99;
    this.bluffed = false;
    this.dt = 0; this.p = null;
    this.callSource = calls;       // audio lures: { sounding(): [{x, z, species, range, id, seq}] }
    this.heardCalls = new Map();   // lure -> last call seq reacted to
    this.perception = senses ? new Perception(profile, senses) : null;
    this.profile = profile;
    this.lureSource = lures;
    this.lure = null;          // bait it's heading to / eating
    this.eatLeft = 0;
    this.unreachable = new WeakSet();
    this.rand = rand;
    this.getPlayerPosition = getPlayerPosition;
    const spot = grid.sample(x, z, 10) ?? { x, z };
    this.agent = new NavAgent(grid, spot.x, spot.z, {
      speed: profile.roamSpeed, acceleration: profile.acceleration, turnRate: profile.turnRate,
    });
    this.home = { x: spot.x, z: spot.z };
    this.state = 'roam';
    this.lastWhy = '';
    this.stateTime = 0;
    this.clock = 0;
    this.history = [];       // [{ t, from, to, why }] newest last, for the debug overlay
    this.target = null;      // noise spot being investigated
    this.lookLeft = 0;
    this.observeCooldown = 0;
    this.flees = 0;          // times it has run from the player this hunt (some cryptids snap)
    this.pauseLeft = 0;
    this.replanTimer = 0;
    this.playerDistance = Infinity;

    // Cryptids with a model get it; the rest keep the greybox capsule.
    this.mesh = buildModel(profile);
    scene.add(this.mesh);
    if (this.perception) scene.add(this.buildAwarenessBar()); // separate from the body so it doesn't change its size
    this.baseColor = new THREE.Color(profile.color);
    this.pickRoamPoint();
    this.syncMesh();
    this.brain = brainFactory(profile.brain ?? profile.id)(this);
  }

  get position() { return { x: this.agent.x, z: this.agent.z }; }

  update(dt) {
    const p = this.getPlayerPosition?.();
    this.playerDistance = p ? Math.hypot(p.x - this.agent.x, p.z - this.agent.z) : Infinity;
    this.perception?.update(dt, this.agent.x, this.agent.z, this.agent.heading);
    this.stateTime += dt;
    this.clock += dt;

    if (this.leavingAtDawn) {          // first light: keep heading away until the hunt removes it
      if (this.state !== 'flee') this.enterFlee(p, 'dawn: leaving');
      else this.tickFlee(dt, p);
    } else if (this.perception) this.think(dt, p);
    else this.thinkL0(dt, p);
    this.agent.update(dt);
    this.syncMesh();
    // What it's looking at (#78 targeting): you when it's watching, stalking, warning or charging;
    // the noise it's checking out; you, a little, as it becomes aware of you.
    if (this.mesh.userData.body3) {
      const look = (this.mesh.userData.look ??= { target: new THREE.Vector3(), weight: 0 });
      const watching = ['observe', 'warn', 'aggress', 'shadow', 'stalk'].includes(this.state);
      if (p && (watching || this.state === 'roam' || this.state === 'flee')) {
        look.target.set(p.x, (p.y ?? 0) + 1.5, p.z);
        look.weight = watching ? 1 : this.state === 'flee' ? 0.35 : Math.min(0.8, (this.perception?.awareness ?? 0) * 1.2);
      } else if (this.state === 'investigate' && this.target) { look.target.set(this.target.x, 0.5, this.target.z); look.weight = 0.9; }
      else look.weight = 0;
    }
    this.mesh.userData.animate?.(dt, this.agent.currentSpeed, this.state);
  }

  // ---------------------------------------------------------------------------------------
  // Behaviour (with senses): each cryptid runs its own behaviour tree (brains/*.js), re-evaluated
  // every tick. Moods it can be in: roam, investigate, observe, shadow, warn, flee, aggress.
  // ---------------------------------------------------------------------------------------
  think(dt, p) {
    this.dt = dt; this.p = p;
    this.observeCooldown = Math.max(0, this.observeCooldown - dt);
    const calm = this.profile.tiers?.[this.level]?.calmRate ?? this.profile.behavior.calmRate ?? 0.01;
    if (this.state !== 'aggress' && this.state !== 'warn') this.agitation = Math.max(0, this.agitation - calm * dt);
    this.brain.tick();
    this.perception.updateStage(this.state);
  }

  /** GDD 5.3 awareness stage: unaware, suspicious, investigating, identified, engaged, lost, reset. */
  get stage() { return this.perception?.stage ?? 'unaware'; }

  emit(type, data = {}) { this.onEvent?.(type, { cryptid: this, name: this.profile.name, ...data }); }

  agitate(amount, why) {
    const before = this.agitation;
    this.agitation = Math.min(1, this.agitation + amount);
    if (why && Math.floor(before * 10) !== Math.floor(this.agitation * 10)) this.lastAgitation = why;
  }

  // --- Charge: a bluff stops short with a roar and then runs; a real one comes all the way. ---
  startCharge({ bluff, why }) {
    this.enterAggress(why);
    this.charge = { bluff, roared: false, hold: 0 };
    if (bluff) this.bluffed = true;
    this.emit('charge', { bluff });
    return 'running';
  }

  tickCharge(dt, p) {
    const ch = this.charge ?? { bluff: false };
    if (ch.bluff) {
      // A bluff is indistinguishable until the last moment: full speed, pulling up ~2 m from you.
      if (!ch.roared && (this.playerDistance <= this.profile.radius + 1.4 || this.stateTime > 4)) {
        ch.roared = true; this.agent.stop(); this.emit('roar', { distance: this.playerDistance });
      }
      if (ch.roared) {
        this.faceToward(p.x, p.z, dt, 6);
        ch.hold += dt;
        if (ch.hold > 1.3) { this.perception.reset(); this.enterFlee(p, 'bluff over'); }
        return 'running';
      }
    }
    this.tickAggress(dt, p);
    return 'running';
  }

  // --- Warning: rear up, whoop, throw a rock that lands near you, then leave. -------------------
  startWarn(miss) {
    this.releaseLure();
    this.setState('warn', 'warning you off');
    this.agent.stop();
    this.warn = { t: 0, thrown: false, miss };
    this.lastWarn = this.clock;
    this.emit('whoop');
    return 'running';
  }

  tickWarn(dt, p) {
    const w = this.warn;
    w.t += dt;
    this.faceToward(p.x, p.z, dt, 5);
    if (!w.thrown && w.t >= 0.7) {
      w.thrown = true;
      const a = this.rand() * Math.PI * 2, r = w.miss * (0.75 + this.rand() * 0.5);
      const to = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r };
      const from = { x: this.agent.x - Math.sin(this.agent.heading) * 0.6, y: this.profile.height * 0.9, z: this.agent.z - Math.cos(this.agent.heading) * 0.6 };
      const land = (at) => {
        const pp = this.getPlayerPosition(), d = Math.hypot(at.x - pp.x, at.z - pp.z);
        this.emit('rock', { x: at.x, z: at.z, distance: d });
        if (d < 1.0) this.emit('rock-hit', { x: at.x, z: at.z });
      };
      if (this.rocks) this.rocks.throw(from, to, { onLand: land }); else land(to);
      this.thrownAt = to;
    }
    if (w.t >= 1.9) this.enterFlee(p, 'warned you');
    return 'running';
  }

  // --- Shadowing: pace the hunter from ~20 m away, sliding sideways out of the light. --------------
  enterShadow(time) {
    this.setState('shadow', 'following you');
    this.shadow = { left: time, replan: 0, side: this.rand() < 0.5 ? -1 : 1 };
    this.agent.speed = this.profile.roamSpeed * 1.15;
  }

  tickShadow(dt, p) {
    const sh = this.shadow;
    sh.left -= dt; sh.replan -= dt;
    if (sh.left <= 0 || this.playerDistance > 60) { this.enterRoam('lost interest'); return 'ok'; }
    if (this.perception.beamLevel > 0) { sh.side = -sh.side; sh.replan = 0; } // slip out of the beam
    if (sh.replan <= 0 || !this.agent.hasPath) {
      sh.replan = 1.5;
      let dx = this.agent.x - p.x, dz = this.agent.z - p.z;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const keep = 21, slide = 5 * sh.side;
      const want = { x: p.x + dx * keep - dz * slide, z: p.z + dz * keep + dx * slide };
      const s = this.agent.grid.sample(want.x, want.z, 4);
      if (s) this.agent.setDestination(s.x, s.z);
    }
    return 'running';
  }

  // ---------------------------------------------------------------------------------------
  // Stalking (#115): instead of bolting the moment it spots you, it keeps you in sight from a
  // distance and circles, reading what you do:
  //   pressure (your light on it, facing it, rushing it, being loud) -> it RETREATS: widens the
  //     ring at speed, slipping back out of the light;
  //   you still, quiet, looking away (or it has lost sight of you) -> it CLOSES: creeps in, a
  //     metre at a time, toward its closest stalking distance;
  //   otherwise it CIRCLES you at its distance, swapping direction now and then.
  // It only knows where you are while it has detected you; otherwise it works from where it last
  // saw or heard you, and gives up after a while (lost contact). Too close, cornered or angry:
  // the brain hands over to warn / charge / flee as before.
  // cfg: { stalkMin, stalkMax, stalkApproach, stalkTime, stalkLose }
  enterStalk(why = 'watching you', cfg = {}) {
    const p = this.perception?.lastSeen ?? this.getPlayerPosition?.() ?? { x: this.agent.x + 1, z: this.agent.z };
    const d = Math.hypot(this.agent.x - p.x, this.agent.z - p.z);
    this.setState('stalk', why);
    this.stalk = { r: Math.max(cfg.stalkMin ?? 14, Math.min(cfg.stalkMax ?? 30, d)), angle: Math.atan2(this.agent.z - p.z, this.agent.x - p.x),
      dir: this.rand() < 0.5 ? -1 : 1, replan: 0, flip: 8 + this.rand() * 8, mode: null, lostFor: 0, pressure: 0 };
    (this.stalkLog ??= []).push({ t: +this.clock.toFixed(2), mode: 'start', why, dist: +d.toFixed(1) });
  }

  tickStalk(dt, p, cfg = {}) {
    const s = this.stalk, pc = this.perception;
    const min = cfg.stalkMin ?? 14, max = cfg.stalkMax ?? 30;
    // What it knows of where you are: you, while it has detected you; otherwise its last sighting.
    const target = pc?.detected ? p : (pc?.lastSeen ?? pc?.lastHeard);
    if (!target) { this.enterRoam('lost you'); return 'ok'; }
    if (!pc?.detected) {
      s.lostFor += dt;
      if (s.lostFor > (cfg.stalkLose ?? 20)) { this.stalkLog.push({ t: +this.clock.toFixed(2), mode: 'lost-contact' }); this.enterRoam('lost contact'); return 'ok'; }
    } else s.lostFor = 0;
    if (this.stateTime > (cfg.stalkTime ?? 90)) { this.stalkLog.push({ t: +this.clock.toFixed(2), mode: 'gave-up' }); this.enterRoam('lost interest'); return 'ok'; }

    // Read what you're doing.
    const toX = this.agent.x - target.x, toZ = this.agent.z - target.z, d = Math.hypot(toX, toZ) || 1;
    let facing = false;
    if (pc?.detected && pc.camera) {
      pc.camera.getWorldDirection(_v);
      const fl = Math.hypot(_v.x, _v.z) || 1;
      facing = (_v.x * toX + _v.z * toZ) / (fl * d) > Math.cos(0.6);
    }
    const pl = pc?.player, vel = pl?.velocity;
    const beam = (pc?.beamLevel ?? 0) > 0;
    const rushing = !!(pc?.detected && vel && (vel.x * toX + vel.z * toZ) / d > 2.2);
    const loud = !!(pc?.detected && (pl?.noise ?? 0) > 0.6);
    const still = !vel || Math.hypot(vel.x, vel.z) < 0.4;
    s.pressure = (beam ? 1 : 0) + (facing ? 0.6 : 0) + (rushing ? 1 : 0) + (loud ? 0.4 : 0);
    const mode = s.pressure >= 1 ? 'retreat' : (!facing && (still || !pc?.detected)) ? 'close' : 'circle';
    if (mode !== s.mode) {
      s.mode = mode;
      this.stalkLog.push({ t: +this.clock.toFixed(2), mode, dist: +d.toFixed(1), beam, facing, rushing, loud });
      if (this.stalkLog.length > 200) this.stalkLog.shift();
      this.emit('stalk', { mode, distance: d });
    }
    // Ring distance and drift round you.
    if (mode === 'retreat') s.r = Math.min(max, Math.max(s.r, d) + 6 * dt);
    else if (mode === 'close') s.r = Math.max(min, Math.min(s.r, d) - (cfg.stalkApproach ?? 1.2) * dt);
    if ((s.flip -= dt) <= 0) { s.dir = -s.dir; s.flip = 8 + this.rand() * 8; }
    s.angle += s.dir * (mode === 'retreat' ? 0.18 : mode === 'circle' ? 0.12 : 0.05) * dt;
    this.agent.speed = this.profile.roamSpeed * (mode === 'retreat' ? 1.8 : mode === 'close' ? 0.55 : 1.0);
    if ((s.replan -= dt) <= 0 || !this.agent.hasPath) {
      s.replan = 0.8;
      const want = { x: target.x + Math.cos(s.angle) * s.r, z: target.z + Math.sin(s.angle) * s.r };
      const at = this.agent.grid.sample(want.x, want.z, 5);
      if (at) this.agent.setDestination(at.x, at.z);
    }
    if (!this.agent.hasPath || this.agent.currentSpeed < 0.2) this.faceToward(target.x, target.z, dt, 2.5);   // stopped: it watches you
    return 'running';
  }

  // L0 behaviour (no senses): roam / bait / flee at a fixed distance.
  thinkL0(dt, p) {
    if (this.state === 'roam' || this.state === 'investigate') {
      const call = this.state === 'roam' || !this.lure ? this.hearCall() : null;
      if (this.playerDistance < this.profile.fleeTriggerDistance) this.enterFlee(p, 'too close');
      else if (call && this.state === 'roam') this.enterInvestigateNoise(call, 'heard a call');
      else if (this.state === 'investigate') { if (call) { this.retargetNoise(call); this.lookLeft = this.profile.behavior.lookAround; } this.tickInvestigate(dt); }
      else if (!this.findLure()) this.tickRoam(dt);
    } else if (this.playerDistance > this.profile.fleeSafeDistance) this.enterRoam('far enough');
    else this.tickFlee(dt, p);
  }

  // A call from an audio lure made for this species, in earshot, not yet reacted to.
  hearCall() {
    if (!this.callSource) return null;
    for (const c of this.callSource.sounding()) {
      if (c.species !== this.profile.id) continue;
      if (Math.hypot(c.x - this.agent.x, c.z - this.agent.z) > c.range) continue;
      if (this.heardCalls.get(c.id) === c.seq) continue;
      this.heardCalls.set(c.id, c.seq);
      return { x: c.x, z: c.z };
    }
    return null;
  }

  // With senses: only once it has actually detected you. Without: the old fixed trigger distance.
  noticesPlayer() {
    return this.perception ? this.perception.detected : this.playerDistance < this.profile.fleeTriggerDistance;
  }

  setState(state, why = '') {
    if (state === this.state && why === this.lastWhy) return;
    this.history.push({ t: this.clock, from: this.state, to: state, why });
    if (this.history.length > 12) this.history.shift();
    this.state = state;
    this.lastWhy = why;
    this.stateTime = 0;
    const tint = STATE_TINT[state];
    this.mesh.userData.body.material.color.copy(tint ?? this.baseColor);
  }

  tickRoam(dt) {
    if (this.agent.hasPath) return;
    if (this.pauseLeft > 0) { this.pauseLeft -= dt; if (this.pauseLeft <= 0) this.pickRoamPoint(); return; }
    const [lo, hi] = this.profile.roamPause;
    this.pauseLeft = lo + this.rand() * (hi - lo);
  }

  tickFlee(dt, player) {
    // Re-plan when nearly out of path, or every so often since the player keeps moving.
    this.replanTimer -= dt;
    if (!this.agent.hasPath || this.agent.remainingDistance < 2 || this.replanTimer <= 0) this.pickFleePoint(player);
  }

  // Nearest bait within smelling range that nobody else is already on. Starts investigating it.
  findLure() {
    if (!this.lureSource) return false;
    let best = null, bestD = this.profile.lureRange;
    for (const l of this.lureSource.lures()) {
      if (l.gone || (l.claimedBy && l.claimedBy !== this) || this.unreachable.has(l)) continue;
      const d = Math.hypot(l.x - this.agent.x, l.z - this.agent.z);
      if (d < bestD) { best = l; bestD = d; }
    }
    if (!best) return false;
    const spot = this.agent.grid.sample(best.x, best.z, 2);
    if (!spot || !this.agent.setDestination(spot.x, spot.z)) { this.unreachable.add(best); return false; }
    this.setState('investigate', 'smelled bait');
    this.lure = best;
    this.target = null;
    best.claimedBy = this;
    this.eatLeft = this.lureSource.eatTime ?? 5;
    this.pauseLeft = 0;
    this.agent.speed = this.profile.roamSpeed * 1.3;   // a bit eager
    return true;
  }

  // Walk over to where a noise came from, then look around there for a while.
  enterInvestigateNoise(spot, why) {
    this.releaseLure();
    this.target = null;
    this.cautious = null;
    this.setState('investigate', why);
    this.lookLeft = this.profile.behavior.lookAround;
    this.agent.speed = this.profile.roamSpeed * this.profile.behavior.investigateSpeed;
    this.retargetNoise(spot);
  }

  retargetNoise(spot) {
    if (this.target && Math.hypot(spot.x - this.target.x, spot.z - this.target.z) < 2) return;
    const s = this.agent.grid.sample(spot.x, spot.z, 3);
    this.target = s ? { x: s.x, z: s.z } : null;
    if (this.target) this.agent.setDestination(this.target.x, this.target.z);
  }

  tickInvestigate(dt) {
    if (!this.lure) {
      // Noise investigation.
      const t = this.target;
      if (!t) { this.enterRoam('nothing there'); return; }
      const cz = this.cautious;
      if (cz && Math.hypot(t.x - this.agent.x, t.z - this.agent.z) > 1.5) {
        // Stalk-and-listen: every few metres it stops dead for a moment, then moves on.
        cz.from ??= { x: this.agent.x, z: this.agent.z };
        if (cz.listen > 0) {
          cz.listen -= dt; this.agent.stop();
          if (cz.listen <= 0) { cz.from = { x: this.agent.x, z: this.agent.z }; this.agent.setDestination(t.x, t.z); }
          return;
        }
        if (Math.hypot(this.agent.x - cz.from.x, this.agent.z - cz.from.z) >= cz.every) { cz.listen = cz.pause; cz.stops = (cz.stops ?? 0) + 1; return; }
      }
      if (Math.hypot(t.x - this.agent.x, t.z - this.agent.z) > 1.5 && this.agent.hasPath) return;
      // At the spot: stop and turn slowly, looking around.
      this.agent.stop();
      this.agent.heading += dt * 1.2;
      this.lookLeft -= dt;
      if (this.lookLeft <= 0) { this.target = null; this.enterRoam('found nothing'); }
      return;
    }
    const l = this.lure;
    if (l.gone) { this.releaseLure(); this.enterRoam('bait gone'); return; }
    const d = Math.hypot(l.x - this.agent.x, l.z - this.agent.z);
    if (d > this.profile.radius + 1.2) {
      if (!this.agent.hasPath) {
        const spot = this.agent.grid.sample(l.x, l.z, 2);
        if (!spot || !this.agent.setDestination(spot.x, spot.z)) { this.unreachable.add(l); this.releaseLure(); this.enterRoam('can\'t reach bait'); }
      }
      return;
    }
    // At the bait: stop, face it and eat.
    this.agent.stop();
    this.agent.heading = Math.atan2(-(l.x - this.agent.x), -(l.z - this.agent.z));
    this.eatLeft -= dt;
    if (this.eatLeft <= 0) {
      this.lureSource.consume(l);
      this.releaseLure();
      this.enterRoam('ate the bait');
    }
  }

  releaseLure() {
    if (this.lure && this.lure.claimedBy === this) this.lure.claimedBy = null;
    this.lure = null;
  }

  // Stop and stare toward where it last saw/heard you.
  enterObserve(why) {
    this.releaseLure();
    this.setState('observe', why);
    this.agent.stop();
  }

  tickObserve(dt, p) {
    const pc = this.perception, B = this.profile.behavior;
    const spot = pc.seen ? p : (pc.lastSeen ?? pc.lastHeard ?? p);
    this.faceToward(spot.x, spot.z, dt, 3);
    if (pc.awareness < B.observeAt * 0.5 || this.stateTime > B.observeTime) {
      // Lost sight / lost interest: go and check where it last saw you, or roam on.
      if (pc.lastSeen && this.stateTime <= B.observeTime) this.enterInvestigateNoise(pc.lastSeen, 'lost sight of you');
      else this.enterRoam('lost interest');
      this.observeCooldown = 4; // don't immediately stop and stare again
    }
  }

  enterAggress(why) {
    this.releaseLure();
    this.setState('aggress', why);
    this.agent.speed = this.profile.behavior.aggressSpeed;
    this.replanTimer = 0;
  }

  tickAggress(dt, p) {
    const B = this.profile.behavior;
    if (this.stateTime > B.aggressTime || this.playerDistance > B.aggressGiveUp) {
      this.perception.reset();
      if (B.afterAggress === 'flee') this.enterFlee(p, 'gave up the chase');
      else this.enterRoam('gave up the chase');
      return;
    }
    this.replanTimer -= dt;
    if (this.replanTimer <= 0 || !this.agent.hasPath) {
      this.replanTimer = 0.4;
      const s = this.agent.grid.sample(p.x, p.z, 2);
      if (s) this.agent.setDestination(s.x, s.z);
    }
  }

  faceToward(x, z, dt, rate) {
    const want = Math.atan2(-(x - this.agent.x), -(z - this.agent.z));
    let d = want - this.agent.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.agent.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }

  enterFlee(player, why = 'detected you') {
    this.releaseLure();
    this.setState('flee', why);
    this.pauseLeft = 0;
    this.agent.speed = this.profile.fleeSpeed;
    this.pickFleePoint(player);
  }

  enterRoam(why = '') {
    this.setState('roam', why);
    this.target = null;
    this.agent.speed = this.profile.roamSpeed;
    // New home where it ended up, so it doesn't wander straight back toward the player.
    this.home = { x: this.agent.x, z: this.agent.z };
    if (this.profile.roamStyle === 'contour') this.contourY = groundAt(this.agent.x, this.agent.z);   // graze on at this height
    this.pickRoamPoint();
  }

  // --- Contour walking (#130, the Sidehill Gouger): keep to one height around the hills, one way. ---
  /** Ground slope direction here: unit gradient (uphill) and its steepness. */
  slopeHere(x = this.agent.x, z = this.agent.z) {
    const e = 1.2, gx = groundAt(x + e, z) - groundAt(x - e, z), gz = groundAt(x, z + e) - groundAt(x, z - e);
    const len = Math.hypot(gx, gz) || 1e-6;
    return { ux: gx / len, uz: gz / len, slope: len / (2 * e) };
  }

  /** A point `dist` metres along the contour (this.contourDir = +1/-1), pulled back toward this.contourY. */
  contourPoint(dist, dir = this.contourDir, from = this.agent) {
    let x = from.x, z = from.z;
    const steps = Math.max(1, Math.round(dist / 3));
    for (let i = 0; i < steps; i++) {
      const s = this.slopeHere(x, z);
      // Along the contour: perpendicular to the uphill vector. On flat ground keep the old heading.
      let tx = -s.uz * dir, tz = s.ux * dir;
      if (s.slope < 0.03) { tx = -Math.sin(this.agent.heading); tz = -Math.cos(this.agent.heading); }
      x += tx * (dist / steps); z += tz * (dist / steps);
      // Height correction: slide up or down the slope back to its contour height.
      const dy = (this.contourY ?? groundAt(x, z)) - groundAt(x, z);
      if (s.slope > 0.03) { const k = Math.max(-2, Math.min(2, dy / Math.max(0.1, s.slope))); x += s.ux * k; z += s.uz * k; }
    }
    return { x, z };
  }

  /** Walk on along the contour; turn round (other way) if the way ahead is blocked. */
  contourStep(dist) {
    this.contourY ??= groundAt(this.agent.x, this.agent.z);
    this.contourDir ??= this.rand() < 0.5 ? 1 : -1;
    for (const dir of [this.contourDir, -this.contourDir]) {
      const t = this.contourPoint(dist, dir), p = this.agent.grid.sample(t.x, t.z, 3);
      if (p && Math.hypot(p.x - this.agent.x, p.z - this.agent.z) > 2 && this.agent.setDestination(p.x, p.z)) { this.contourDir = dir; return true; }
    }
    // Stuck at a dead end: drift to a new contour a little higher or lower.
    this.contourY = groundAt(this.agent.x, this.agent.z) + (this.rand() - 0.5) * 4;
    return false;
  }

  pickRoamPoint() {
    // roamStyle 'directional': keeps travelling the same general way (a route, a contour line)
    // instead of milling about its home; it turns back only when the way ahead is blocked.
    if (this.profile.roamStyle === 'contour' && this.contourStep(this.profile.roamRadius * 0.5)) return;
    if (this.profile.roamStyle === 'directional') {
      const step = this.profile.roamRadius * 0.6;
      for (let i = 0; i < 8; i++) {
        const turn = (this.rand() - 0.5) * 0.6 + (i >= 4 ? Math.PI : 0);
        const h = this.agent.heading + turn;
        const p = this.agent.grid.sample(this.agent.x - Math.sin(h) * step, this.agent.z - Math.cos(h) * step, 4);
        if (p && Math.hypot(p.x - this.agent.x, p.z - this.agent.z) > 3 && this.agent.setDestination(p.x, p.z)) return;
      }
    }
    for (let i = 0; i < 6; i++) {
      const p = this.agent.grid.randomPoint(this.home.x, this.home.z, this.profile.roamRadius, this.rand);
      if (p && Math.hypot(p.x - this.agent.x, p.z - this.agent.z) > 2 && this.agent.setDestination(p.x, p.z)) return;
    }
  }

  pickFleePoint(player) {
    this.replanTimer = 1.0;
    // fleeStyle 'contour' (#130): bolt along the slope (traversable for it, hard going for you),
    // whichever way along the contour takes it away from you.
    if (this.profile.fleeStyle === 'contour') {
      this.contourY ??= groundAt(this.agent.x, this.agent.z);
      const away = [1, -1].map((dir) => ({ dir, p: this.contourPoint(this.profile.fleeStep, dir) }))
        .sort((a, b) => Math.hypot(b.p.x - player.x, b.p.z - player.z) - Math.hypot(a.p.x - player.x, a.p.z - player.z));
      for (const { dir, p } of away) {
        const s = this.agent.grid.sample(p.x, p.z, 3);
        if (s && Math.hypot(s.x - player.x, s.z - player.z) > Math.hypot(this.agent.x - player.x, this.agent.z - player.z) + 1 && this.agent.setDestination(s.x, s.z)) { this.contourDir = dir; return; }
      }
    }
    const ax = this.agent.x, az = this.agent.z;
    let awayX = ax - player.x, awayZ = az - player.z;
    const len = Math.hypot(awayX, awayZ) || 1;
    awayX /= len; awayZ /= len;
    const here = Math.hypot(ax - player.x, az - player.z);

    // Straight away first, then fan out left/right so walls don't pin it.
    let fallback = null;
    for (let i = 0; i < 14; i++) {
      const angle = i === 0 ? 0 : Math.ceil(i / 2) * 0.35 * (i % 2 ? 1 : -1);
      const c = Math.cos(angle), s = Math.sin(angle);
      const dx = awayX * c - awayZ * s, dz = awayX * s + awayZ * c;
      const p = this.agent.grid.sample(ax + dx * this.profile.fleeStep, az + dz * this.profile.fleeStep, 3);
      if (!p) continue;
      const gain = Math.hypot(p.x - player.x, p.z - player.z) - here;
      if (gain <= 1) continue;
      if (this.agent.setDestination(p.x, p.z)) {
        // Reject paths whose first leg heads toward the player (e.g. around a wall past them).
        const wp = this.agent.path[1] ?? p;
        const first = (wp.x - ax) * awayX + (wp.z - az) * awayZ;
        if (first > -0.5 || fallback) return;
        fallback = p;
      }
    }
    if (fallback) this.agent.setDestination(fallback.x, fallback.z);
  }

  syncMesh() {
    this.mesh.position.set(this.agent.x, groundAt(this.agent.x, this.agent.z), this.agent.z);
    this.mesh.rotation.y = this.agent.heading;
    const bar = this.awarenessBar;
    if (bar && this.perception) {
      bar.position.set(this.agent.x, this.profile.height + 0.35, this.agent.z);
      const a = this.perception.awareness;
      bar.visible = a > 0.02;
      bar.userData.fill.scale.x = Math.max(0.001, a);
      bar.userData.fill.material.color.set(this.perception.detected ? 0xff3b2f : this.perception.seen ? 0xffc23a : 0xd8d8d8);
    }
  }

  // Greybox "it's noticing you" meter above the head: grey (heard) -> amber (seen) -> red (detected).
  buildAwarenessBar() {
    const g = new THREE.Group();
    const w = 1.0, h = 0.16;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x111111, fog: false, depthTest: false, transparent: true, opacity: 0.7 }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(w / 2, 0, 0), new THREE.MeshBasicMaterial({ color: 0xd8d8d8, fog: false, depthTest: false }));
    fill.position.x = -w / 2;
    fill.position.z = 0.001;
    back.renderOrder = fill.renderOrder = 10;
    g.add(back, fill);
    g.position.y = this.profile.height + 0.35;
    g.userData.fill = fill;
    this.awarenessBar = g;
    // Always face the camera, and grow with distance so it stays readable at the low render resolution.
    fill.onBeforeRender = back.onBeforeRender = (r, s, cam) => {
      g.quaternion.copy(cam.quaternion);
      const d = cam.position.distanceTo(g.position);
      g.scale.setScalar(Math.max(1, d / 8));
    };
    return g;
  }

  dispose() {
    this.awarenessBar?.removeFromParent();
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => { o.geometry?.dispose(); [o.material].flat().forEach((m) => m?.dispose()); });
  }
}

// L0 placeholder: capsule sized to the profile, feet at the origin, with a "nose" showing facing.

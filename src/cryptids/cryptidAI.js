import * as THREE from 'three';
import { NavAgent } from './navAgent.js';
import { DEFAULT_PROFILE } from './profiles.js';
import { Perception } from './perception.js';
import { buildBigfootModel } from './bigfootModel.js';
import { genericBrain } from './brains/genericBrain.js';
import { bigfootBrain, BIGFOOT_TIERS } from './brains/bigfootBrain.js';

// Bespoke behaviour trees per cryptid (lore first, then the rules the player must learn).
const BRAINS = { bigfoot: bigfootBrain };

// Body tint per state (greybox readability); roam/investigate keep the cryptid's own colour.
const STATE_TINT = {
  warn: new THREE.Color(0xd0702a),
  shadow: new THREE.Color(0x5a4a3a),
  observe: new THREE.Color(0xb08a3a),
  flee: new THREE.Color(0xc0392b),
  aggress: new THREE.Color(0xe0581a),
};

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
  constructor({ scene, grid, profile = DEFAULT_PROFILE, x = 0, z = 0, getPlayerPosition, rand = Math.random, lures = null, senses = null, calls = null, level = null, rocks = null, onEvent = null }) {
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
    this.mesh = profile.id === 'bigfoot' ? buildBigfootModel(profile) : buildCapsule(profile);
    scene.add(this.mesh);
    if (this.perception) scene.add(this.buildAwarenessBar()); // separate from the body so it doesn't change its size
    this.baseColor = new THREE.Color(profile.color);
    this.pickRoamPoint();
    this.syncMesh();
    this.brain = (BRAINS[profile.brain ?? profile.id] ?? genericBrain)(this);
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
    this.mesh.userData.animate?.(dt, this.agent.currentSpeed, this.state);
  }

  // ---------------------------------------------------------------------------------------
  // Behaviour (with senses): each cryptid runs its own behaviour tree (brains/*.js), re-evaluated
  // every tick. Moods it can be in: roam, investigate, observe, shadow, warn, flee, aggress.
  // ---------------------------------------------------------------------------------------
  think(dt, p) {
    this.dt = dt; this.p = p;
    this.observeCooldown = Math.max(0, this.observeCooldown - dt);
    const calm = (BIGFOOT_TIERS[this.level]?.calmRate ?? 0.01);
    if (this.state !== 'aggress' && this.state !== 'warn') this.agitation = Math.max(0, this.agitation - calm * dt);
    this.brain.tick();
  }

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
    this.pickRoamPoint();
  }

  pickRoamPoint() {
    for (let i = 0; i < 6; i++) {
      const p = this.agent.grid.randomPoint(this.home.x, this.home.z, this.profile.roamRadius, this.rand);
      if (p && Math.hypot(p.x - this.agent.x, p.z - this.agent.z) > 2 && this.agent.setDestination(p.x, p.z)) return;
    }
  }

  pickFleePoint(player) {
    this.replanTimer = 1.0;
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
    this.mesh.position.set(this.agent.x, 0, this.agent.z);
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
function buildCapsule(profile) {
  const group = new THREE.Group();
  group.name = `cryptid-${profile.id}`;
  const r = profile.radius;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r, Math.max(0.01, profile.height - 2 * r), 6, 12),
    // Slight self-glow so the greybox capsule reads at night even outside the flashlight.
    new THREE.MeshStandardMaterial({ color: profile.color, roughness: 0.8, emissive: 0x1a1410 }),
  );
  body.position.y = profile.height / 2;
  body.castShadow = body.receiveShadow = true;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(r * 0.8, 0.15, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xd8c8a0, emissive: 0x2a2418 }),
  );
  nose.position.set(0, profile.height * 0.85, -r);
  group.add(body, nose);
  group.userData.body = body;
  return group;
}

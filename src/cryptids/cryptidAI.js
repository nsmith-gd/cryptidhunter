import * as THREE from 'three';
import { NavAgent } from './navAgent.js';
import { DEFAULT_PROFILE } from './profiles.js';
import { Perception } from './perception.js';
import { buildBigfootModel } from './bigfootModel.js';

// Body tint per state (greybox readability); roam/investigate keep the cryptid's own colour.
const STATE_TINT = {
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
   *   senses: { player, flashlight, camera, colliders, lightLevel } (optional: enables hearing + sight) }
   */
  constructor({ scene, grid, profile = DEFAULT_PROFILE, x = 0, z = 0, getPlayerPosition, rand = Math.random, lures = null, senses = null }) {
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
  }

  get position() { return { x: this.agent.x, z: this.agent.z }; }

  update(dt) {
    const p = this.getPlayerPosition?.();
    this.playerDistance = p ? Math.hypot(p.x - this.agent.x, p.z - this.agent.z) : Infinity;
    this.perception?.update(dt, this.agent.x, this.agent.z, this.agent.heading);
    this.stateTime += dt;
    this.clock += dt;

    if (this.perception) this.think(dt, p);
    else this.thinkL0(dt, p);
    this.agent.update(dt);
    this.syncMesh();
    this.mesh.userData.animate?.(dt, this.agent.currentSpeed, this.state);
  }

  // ---------------------------------------------------------------------------------------
  // Behaviour state machine (with senses):
  //   ROAM        wander around home; bait pulls it to INVESTIGATE
  //   INVESTIGATE walk to a noise it heard (or bait), then look around there
  //   OBSERVE     glimpsed something: stop, face it and stare while it makes up its mind
  //   FLEE        detected you and it's shy: run until far away and calm
  //   AGGRESS     detected you and it's hostile: come straight for you, give up after a while
  // ---------------------------------------------------------------------------------------
  think(dt, p) {
    const B = this.profile.behavior, pc = this.perception;
    const calm = this.state === 'roam' || this.state === 'investigate' || this.state === 'observe';

    // Detection overrides everything calm.
    if (calm && this.noticesPlayer()) {
      if (B.onDetect === 'aggress') this.enterAggress('detected you');
      else this.enterFlee(p, 'detected you');
      return;
    }
    // Glimpsed you (not sure yet): stop and stare.
    this.observeCooldown = Math.max(0, this.observeCooldown - dt);
    if ((this.state === 'roam' || this.state === 'investigate') && pc.seen && pc.awareness >= B.observeAt && this.observeCooldown <= 0) {
      this.enterObserve('glimpsed you');
      return;
    }

    switch (this.state) {
      case 'roam':
        if (pc.heard && pc.hearLevel >= B.investigateHear && pc.lastHeard) this.enterInvestigateNoise(pc.lastHeard, 'heard a noise');
        else if (!this.findLure()) this.tickRoam(dt);
        break;
      case 'investigate':
        // A fresh, louder noise updates where it's heading.
        if (!this.lure && pc.heard && pc.hearLevel >= B.investigateHear && pc.lastHeard) this.retargetNoise(pc.lastHeard);
        this.tickInvestigate(dt);
        break;
      case 'observe':
        this.tickObserve(dt, p);
        break;
      case 'flee':
        if (this.playerDistance > this.profile.fleeSafeDistance && !pc.detected) this.enterRoam('lost you');
        else this.tickFlee(dt, p);
        break;
      case 'aggress':
        this.tickAggress(dt, p);
        break;
    }
  }

  // L0 behaviour (no senses): roam / bait / flee at a fixed distance.
  thinkL0(dt, p) {
    if (this.state === 'roam' || this.state === 'investigate') {
      if (this.playerDistance < this.profile.fleeTriggerDistance) this.enterFlee(p, 'too close');
      else if (this.state === 'investigate') this.tickInvestigate(dt);
      else if (!this.findLure()) this.tickRoam(dt);
    } else if (this.playerDistance > this.profile.fleeSafeDistance) this.enterRoam('far enough');
    else this.tickFlee(dt, p);
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

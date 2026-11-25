import * as THREE from 'three';
import { NavAgent } from './navAgent.js';
import { DEFAULT_PROFILE } from './profiles.js';

const FLEE_TINT = new THREE.Color(0xc0392b);

// Shared cryptid brain (L0 greybox): wander between random walkable points around home,
// bolt away when the player gets inside the flee distance, calm down once safe.
// Lures (bait) it can smell pull it off its roam: it walks over, eats, then roams from there.
// Hearing / sight / investigate / attack / clue-dropping come at later levels.
export class CryptidAI {
  /**
   * @param {object} o { scene, grid, profile, x, z, getPlayerPosition: () => THREE.Vector3, rand,
   *   lures: { lures(): {x, z, gone, claimedBy}[], consume(lure), eatTime } (optional) }
   */
  constructor({ scene, grid, profile = DEFAULT_PROFILE, x = 0, z = 0, getPlayerPosition, rand = Math.random, lures = null }) {
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
    this.pauseLeft = 0;
    this.replanTimer = 0;
    this.playerDistance = Infinity;

    this.mesh = buildCapsule(profile);
    scene.add(this.mesh);
    this.baseColor = new THREE.Color(profile.color);
    this.pickRoamPoint();
    this.syncMesh();
  }

  get position() { return { x: this.agent.x, z: this.agent.z }; }

  update(dt) {
    const p = this.getPlayerPosition?.();
    this.playerDistance = p ? Math.hypot(p.x - this.agent.x, p.z - this.agent.z) : Infinity;

    if (this.state === 'roam' || this.state === 'investigate') {
      if (this.playerDistance < this.profile.fleeTriggerDistance) this.enterFlee(p);
      else if (this.state === 'investigate') this.tickInvestigate(dt);
      else if (!this.findLure()) this.tickRoam(dt);
    } else {
      if (this.playerDistance > this.profile.fleeSafeDistance) this.enterRoam();
      else this.tickFlee(dt, p);
    }
    this.agent.update(dt);
    this.syncMesh();
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
    this.state = 'investigate';
    this.lure = best;
    best.claimedBy = this;
    this.eatLeft = this.lureSource.eatTime ?? 5;
    this.pauseLeft = 0;
    this.agent.speed = this.profile.roamSpeed * 1.3;   // a bit eager
    return true;
  }

  tickInvestigate(dt) {
    const l = this.lure;
    if (!l || l.gone) { this.releaseLure(); this.enterRoam(); return; }
    const d = Math.hypot(l.x - this.agent.x, l.z - this.agent.z);
    if (d > this.profile.radius + 1.2) {
      if (!this.agent.hasPath) {
        const spot = this.agent.grid.sample(l.x, l.z, 2);
        if (!spot || !this.agent.setDestination(spot.x, spot.z)) { this.unreachable.add(l); this.releaseLure(); this.enterRoam(); }
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
      this.enterRoam();
    }
  }

  releaseLure() {
    if (this.lure && this.lure.claimedBy === this) this.lure.claimedBy = null;
    this.lure = null;
  }

  enterFlee(player) {
    this.releaseLure();
    this.state = 'flee';
    this.pauseLeft = 0;
    this.agent.speed = this.profile.fleeSpeed;
    this.mesh.userData.body.material.color.copy(FLEE_TINT);
    this.pickFleePoint(player);
  }

  enterRoam() {
    this.state = 'roam';
    this.agent.speed = this.profile.roamSpeed;
    this.mesh.userData.body.material.color.copy(this.baseColor);
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
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
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

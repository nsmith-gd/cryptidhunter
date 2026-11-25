import * as THREE from 'three';
import { NavAgent } from './navAgent.js';
import { DEFAULT_PROFILE } from './profiles.js';

const FLEE_TINT = new THREE.Color(0xc0392b);

// Shared cryptid brain (L0 greybox): wander between random walkable points around home,
// bolt away when the player gets inside the flee distance, calm down once safe.
// Hearing / sight / investigate / attack / clue-dropping come at later levels.
export class CryptidAI {
  /**
   * @param {object} o { scene, grid, profile, x, z, getPlayerPosition: () => THREE.Vector3, rand }
   */
  constructor({ scene, grid, profile = DEFAULT_PROFILE, x = 0, z = 0, getPlayerPosition, rand = Math.random }) {
    this.profile = profile;
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

    if (this.state === 'roam') {
      if (this.playerDistance < this.profile.fleeTriggerDistance) this.enterFlee(p);
      else this.tickRoam(dt);
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

  enterFlee(player) {
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

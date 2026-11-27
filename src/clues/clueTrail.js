import * as THREE from 'three';
import { stream } from '../core/rng.js';

const PATH_STEP = 0.25;   // metres between recorded debug-path points
const PATH_MAX = 4000;    // points kept per cryptid

// Watches one cryptid and drops its clues along the route it actually walks:
// footprints every stride (alternating feet), hair tufts and scratch marks every so many metres.
// Scratches go on a nearby tall surface (tree trunk / rock); if none is in reach they wait.
// Also records the true route so it can be drawn as a debug path.
export class ClueTrail {
  constructor(cryptid, clueSystem, colliders, rand = stream(`clues:${cryptid.profile.id}`)) {
    this.cryptid = cryptid;
    this.clues = clueSystem;
    this.colliders = colliders;
    this.rand = rand;
    this.spec = cryptid.profile.clues ?? {};
    const p = cryptid.position;
    this.last = { x: p.x, z: p.z };
    this.sinceStep = 0;
    this.leftFoot = true;
    this.hairIn = this.nextGap(this.spec.hair);
    this.scratchIn = this.nextGap(this.spec.scratch);
    this.branchIn = this.nextGap(this.spec.branch);
    this.scatIn = this.nextGap(this.spec.scat);
    this.path = [{ x: p.x, z: p.z }];
    this.sincePathPoint = 0;
    this.line = null;
  }

  nextGap(spec) {
    if (!spec?.every) return Infinity;
    const [lo, hi] = spec.every;
    return lo + this.rand() * (hi - lo);
  }

  update() {
    const p = this.cryptid.position;
    const dx = p.x - this.last.x, dz = p.z - this.last.z;
    const moved = Math.hypot(dx, dz);
    if (moved < 1e-4) return;
    this.last = { x: p.x, z: p.z };
    const heading = this.cryptid.agent.heading;

    this.sincePathPoint += moved;
    if (this.sincePathPoint >= PATH_STEP) {
      this.sincePathPoint = 0;
      this.path.push({ x: p.x, z: p.z });
      if (this.path.length > PATH_MAX) this.path.shift();
      if (this.line) this.refreshLine();
    }

    const fp = this.spec.footprint;
    if (fp) {
      this.sinceStep += moved;
      if (this.sinceStep >= fp.stride) {
        this.sinceStep -= fp.stride;
        this.dropFootprint(p, heading, fp);
      }
    }
    if (this.spec.hair) {
      this.hairIn -= moved;
      if (this.hairIn <= 0) { this.hairIn = this.nextGap(this.spec.hair); this.dropHair(p); }
    }
    if (this.spec.scratch) {
      this.scratchIn -= moved;
      if (this.scratchIn <= 0 && this.dropScratch(p)) this.scratchIn = this.nextGap(this.spec.scratch);
    }
    // #84: limbs snapped high as it pushes through, and droppings now and then.
    if (this.spec.branch) {
      this.branchIn -= moved;
      if (this.branchIn <= 0 && this.dropScratch(p, 'branch')) this.branchIn = this.nextGap(this.spec.branch);
    }
    if (this.spec.scat) {
      this.scatIn -= moved;
      if (this.scatIn <= 0) { this.scatIn = this.nextGap(this.spec.scat); this.dropScat(p); }
    }
  }

  dropFootprint(p, heading, fp) {
    // Feet sit either side of the walking line: right vector of heading is (cos h, -sin h).
    const side = (this.leftFoot ? -1 : 1) * fp.width * 0.9;
    // Lopsided gait (#130, the Sidehill Gouger): its short-legged side leaves shorter prints, so a
    // trail of them reads as something walking across a slope, always with the same side uphill.
    if (fp.uneven && this.leftFoot) fp = { ...fp, length: fp.length * fp.uneven, short: true };
    this.leftFoot = !this.leftFoot;
    this.clues.spawn('footprint', {
      cryptidId: this.cryptid.profile.id,
      position: { x: p.x + Math.cos(heading) * side, y: 0, z: p.z - Math.sin(heading) * side },
      rotationY: heading, origin: { x: p.x, z: p.z }, data: fp,
    });
  }

  dropHair(p) {
    this.clues.spawn('hair', {
      cryptidId: this.cryptid.profile.id,
      position: { x: p.x + (this.rand() - 0.5) * 0.4, y: 0, z: p.z + (this.rand() - 0.5) * 0.4 },
      origin: { x: p.x, z: p.z }, data: this.spec.hair,
    });
  }

  dropScat(p) {
    this.clues.spawn('scat', {
      cryptidId: this.cryptid.profile.id,
      position: { x: p.x + (this.rand() - 0.5) * 0.6, y: 0, z: p.z + (this.rand() - 0.5) * 0.6 },
      rotationY: this.rand() * Math.PI * 2, origin: { x: p.x, z: p.z }, data: this.spec.scat,
    });
  }

  /** Mark the nearest tall surface within reach (claw scratches, or a snapped branch).
   *  Returns false if there's nothing tall enough in reach. */
  dropScratch(p, type = 'scratch') {
    const spec = this.spec[type];
    const reach = spec.reach ?? 2.5;
    const [hLo, hHi] = spec.height ?? [1.4, 2.2];
    let best = null;
    for (const c of this.colliders) {
      if (c.min.y > 0.5 || c.max.y < hHi) continue; // must stand on the ground and be tall enough
      const cx = Math.min(Math.max(p.x, c.min.x), c.max.x);
      const cz = Math.min(Math.max(p.z, c.min.z), c.max.z);
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d > 0.01 && d <= reach && (!best || d < best.d)) best = { d, cx, cz };
    }
    if (!best) return false;
    // Face normal points from the surface toward the cryptid (axis-aligned box faces).
    const nx = p.x - best.cx, nz = p.z - best.cz;
    const normalAngle = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (nz > 0 ? 0 : Math.PI);
    this.clues.spawn(type, {
      cryptidId: this.cryptid.profile.id,
      position: { x: best.cx, y: hLo + this.rand() * (hHi - hLo), z: best.cz },
      rotationY: normalAngle, origin: { x: p.x, z: p.z }, data: spec,
    });
    return true;
  }

  // --- debug path -------------------------------------------------------------------------
  showPath(scene, visible) {
    if (visible && !this.line) {
      this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffee44, depthTest: false }));
      this.line.renderOrder = 10;
      this.line.name = `debug-path-${this.cryptid.profile.id}`;
      scene.add(this.line);
      this.refreshLine();
    }
    if (this.line) this.line.visible = visible;
  }

  refreshLine() {
    const pts = this.path.map((q) => new THREE.Vector3(q.x, 0.05, q.z));
    this.line.geometry.setFromPoints(pts);
  }

  /** Distance from a point to the recorded route (for verification). */
  distanceToPath(x, z) {
    let best = Infinity;
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
    }
    return best;
  }

  dispose() {
    if (this.line) { this.line.removeFromParent(); this.line.geometry.dispose(); this.line.material.dispose(); }
  }
}

// Keeps one ClueTrail per live cryptid (handles cryptids spawned/cleared at runtime).
export class ClueTrails {
  constructor(scene, cryptidManager, clueSystem, colliders) {
    this.scene = scene;
    this.manager = cryptidManager;
    this.clues = clueSystem;
    this.colliders = colliders;
    this.trails = new Map();
    this.debug = false;
  }

  setDebug(on) {
    this.debug = on;
    for (const t of this.trails.values()) t.showPath(this.scene, on);
  }

  update() {
    const live = new Set(this.manager.cryptids);
    for (const [c, t] of this.trails) if (!live.has(c)) { t.dispose(); this.trails.delete(c); }
    for (const c of live) {
      let t = this.trails.get(c);
      if (!t) {
        t = new ClueTrail(c, this.clues, this.colliders);
        this.trails.set(c, t);
        if (this.debug) t.showPath(this.scene, true);
      }
      t.update();
    }
  }

  trailFor(cryptid) { return this.trails.get(cryptid); }
}

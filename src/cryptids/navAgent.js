// Moves a body along NavGrid paths: accelerates toward its speed, turns to face where it's going,
// slows into the final waypoint. Position is the feet (y = 0 on the ground).

export class NavAgent {
  constructor(grid, x, z, { speed = 2, acceleration = 12, turnRate = 8, stoppingDistance = 0.3 } = {}) {
    this.grid = grid;
    this.x = x;
    this.z = z;
    this.heading = 0; // radians, 0 = facing -Z (matches three.js forward)
    this.speed = speed;
    this.acceleration = acceleration;
    this.turnRate = turnRate;
    this.stoppingDistance = stoppingDistance;
    this.currentSpeed = 0;
    this.path = null;
    this.index = 0;
  }

  /** Path to a world point. Returns false if unreachable. */
  setDestination(x, z) {
    const path = this.grid.findPath(this.x, this.z, x, z);
    if (!path) return false;
    this.path = path;
    this.index = 1;
    return true;
  }

  stop() { this.path = null; }

  get hasPath() { return !!this.path && this.index < this.path.length; }

  get destination() { return this.path ? this.path[this.path.length - 1] : null; }

  get remainingDistance() {
    if (!this.hasPath) return 0;
    let d = Math.hypot(this.path[this.index].x - this.x, this.path[this.index].z - this.z);
    for (let i = this.index; i < this.path.length - 1; i++)
      d += Math.hypot(this.path[i + 1].x - this.path[i].x, this.path[i + 1].z - this.path[i].z);
    return d;
  }

  update(dt) {
    if (!this.hasPath) {
      this.currentSpeed = Math.max(0, this.currentSpeed - this.acceleration * dt);
      return;
    }
    let wp = this.path[this.index];
    let dx = wp.x - this.x, dz = wp.z - this.z;
    let dist = Math.hypot(dx, dz);
    const last = this.index === this.path.length - 1;
    if (dist < (last ? this.stoppingDistance : 0.4)) {
      this.index++;
      if (!this.hasPath) { this.path = null; return; }
      wp = this.path[this.index];
      dx = wp.x - this.x; dz = wp.z - this.z;
      dist = Math.hypot(dx, dz);
    }

    // Brake into the final point, otherwise accelerate to cruise speed.
    const remaining = this.remainingDistance;
    const brakeSpeed = Math.sqrt(2 * this.acceleration * Math.max(0, remaining - this.stoppingDistance));
    const target = Math.min(this.speed, brakeSpeed);
    const k = this.acceleration * dt;
    this.currentSpeed += clamp(target - this.currentSpeed, -k, k);

    // Turn toward the waypoint; move along the facing so turns read as turns.
    const want = Math.atan2(-dx, -dz);
    let diff = ((want - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += clamp(diff, -this.turnRate * dt, this.turnRate * dt);
    // Don't run full speed while facing the wrong way.
    const align = Math.max(0.15, Math.cos(diff));
    const step = Math.min(dist, this.currentSpeed * align * dt);
    if (dist > 1e-4) {
      const nx = this.x + (dx / dist) * step, nz = this.z + (dz / dist) * step;
      if (this.grid.isWalkable(nx, nz)) { this.x = nx; this.z = nz; }
      else this.path = null; // map changed under us; AI will re-plan
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

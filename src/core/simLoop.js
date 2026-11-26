// Fixed-step simulation with render interpolation (GDD 14.2, 16.1).
// The world advances in exact SIM_STEP slices no matter how fast the screen redraws, so
// movement, stamina, battery, clocks and AI timing are identical at 30 or 144 fps. Each
// rendered frame shows tracked objects interpolated between the last two simulation states.

export const SIM_HZ = 60;
export const SIM_STEP = 1 / SIM_HZ;
const MAX_STEPS_PER_FRAME = 8;   // after a long hitch, drop time rather than spiral

export class FixedStepLoop {
  /**
   * simulate(dt): advance the world one fixed step.
   * present(frameDt, alpha): per-frame presentation (HUD, post effects, draw); alpha in [0,1)
   *   is how far the current moment lies between the previous and the latest sim state.
   * tracked(): Object3Ds whose positions are interpolated for rendering.
   */
  constructor({ simulate, present, tracked = () => [] }) {
    this.simulate = simulate;
    this.present = present;
    this.tracked = tracked;
    this.acc = 0;
    this.tick = 0;          // sim steps taken since start
    this.prev = new Map();  // object -> {x,y,z} before the latest step
    this.curr = new Map();  // object -> {x,y,z} after the latest step
  }

  /** Run as much simulation as realDt covers, then present one frame. */
  frame(realDt) {
    this.acc += Math.min(Math.max(realDt, 0), MAX_STEPS_PER_FRAME * SIM_STEP);
    let steps = 0;
    while (this.acc >= SIM_STEP - 1e-9 && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.acc -= SIM_STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, SIM_STEP);
    const alpha = Math.min(1, Math.max(0, this.acc / SIM_STEP));
    this.interpolate(alpha);
    this.present(realDt, alpha);
    this.restore();
    return steps;
  }

  /** Advance exactly one simulation step (also used by tests to drive the sim directly). */
  step() {
    const objs = this.tracked();
    for (const o of objs) if (o) this.prev.set(o, snap(o));
    this.simulate(SIM_STEP);
    this.tick++;
    for (const o of objs) if (o) this.curr.set(o, snap(o));
  }

  // Draw tracked objects between their last two sim positions; put the sim values back after.
  interpolate(alpha) {
    this.saved = [];
    for (const [o, c] of this.curr) {
      const p = this.prev.get(o);
      if (!p || !o.position || o.position.x !== c.x || o.position.y !== c.y || o.position.z !== c.z) continue; // moved outside the sim (teleport/debug): leave it
      this.saved.push([o, c]);
      o.position.set(p.x + (c.x - p.x) * alpha, p.y + (c.y - p.y) * alpha, p.z + (c.z - p.z) * alpha);
    }
  }

  restore() {
    for (const [o, c] of this.saved ?? []) o.position.set(c.x, c.y, c.z);
    this.saved = null;
  }
}

function snap(o) { return { x: o.position.x, y: o.position.y, z: o.position.z }; }

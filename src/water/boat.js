import * as THREE from 'three';

// Rental motorboat (GDD 1.5 L05, 6.2 E07, S13 boat handling; task #139). Greybox hull and outboard.
//
//   Board        E within reach of the boat, from the dock, the shore or swimming beside it.
//   Steer        Space pulls the cord (engine on/off). W throttle, S reverse (slow), A/D turn. The outboard burns fuel with throttle. No
//                fuel: it dies and you paddle (slow). The engine's vibration carries through the water
//                (`vibration`, 0..1) for anything below that listens for it.
//   Leave        E again: onto the dock or shore if there's footing beside you, otherwise over the side.
//   Stability    The hull heels (`tilt`, 0..1+) when you turn hard at speed, in storm waves, and when
//                something bumps it from below (`bump()`). It settles back on its own. At 1 it capsizes:
//                you're thrown into the water and the boat floats upside down.
//   Right it     swim beside the capsized hull and hold E for a few seconds. Or leave it and swim for
//                the shore: a dry land exit always exists (GDD 12.2).
// The fuel tank is a plain object { fuel: 0..1 } so a shared power budget can own it later.

export const BOAT = {
  speed: 5.0, reverse: 0.4, paddle: 0.9, turn: 1.0, accel: 2.5,
  fuelPerSec: 0.008,                   // tank fraction per second at full throttle (~2 min of full power)
  reach: 3.2,                          // metres: how close you must be to climb in
  seat: 0.35,                          // your height sitting in it
  heelTurn: 0.42,                      // heel per second turning hard at full speed (scales with speed²)
  settle: 0.5,                         // fraction of heel the hull rights per second
  waveHeel: 0.28,                      // storm: wave-driven heel amplitude
  bumpHeel: 0.55,                      // a bump from below
  capsizeAt: 1,
  rightTime: 2.5,                      // seconds holding E beside the hull to flip it back
  rightReach: 2.8,
  stormDrift: 0.7,                     // m/s the storm pushes the boat (and a hull adrift)
};

export class Boat {
  /**
   * isWater(x, z) -> bool: where the hull may float. footingAt(x, z) -> 'dry' | 'shallow' | 'deep'.
   * tank: { fuel } (shared with the power budget). storm: () => 0..1.
   */
  constructor({ scene = null, x, z, heading = 0, isWater, footingAt, tank = { fuel: 1 }, storm = () => 0, trace = () => {}, notify = () => {} }) {
    Object.assign(this, { x, z, heading, isWater, footingAt, tank, storm, trace, notify });
    this.home = { x, z, heading };
    this.state = 'moored';       // moored | aboard | adrift | capsized
    this.engine = false;
    this.throttle = 0; this.speed = 0; this.turnInput = 0;
    this.tilt = 0; this.heelSide = 1; this.time = 0;
    this.righting = 0;           // seconds of E held toward righting it
    this.capsizes = 0;
    this.mesh = scene ? this.buildMesh(scene) : null;
    this.place();
  }

  get aboard() { return this.state === 'aboard'; }
  get capsized() { return this.state === 'capsized'; }
  /** Engine vibration carried through the water: running engine, more with throttle. */
  get vibration() { return this.engine && this.tank.fuel > 0 ? 0.35 + 0.65 * Math.abs(this.throttle) : 0; }

  buildMesh(scene) {
    const g = new THREE.Group(); g.name = 'rental-boat';
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.8), hullMat); hull.position.y = 0.25; hull.castShadow = true;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.1, 4, 1), hullMat); bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1, 1, 0.45); bow.position.set(0, 0.25, -2.4);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 3.82), new THREE.MeshStandardMaterial({ color: 0xc04a2a })); stripe.position.y = 0.42;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x6a4a2a })); seat.position.set(0, 0.45, 0.6);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.45), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4 })); motor.position.set(0, 0.7, 2.05);
    g.add(hull, bow, stripe, seat, motor);
    scene.add(g);
    return g;
  }

  place() {
    if (!this.mesh) return;
    this.mesh.position.set(this.x, this.capsized ? 0.1 : 0, this.z);
    this.mesh.rotation.set(0, this.heading, 0);
    this.mesh.rotation.z = this.capsized ? Math.PI : this.heelSide * Math.min(1, this.tilt) * 0.55 + Math.sin(this.time * 1.7) * 0.03;
  }

  dist(p) { return Math.hypot(p.x - this.x, p.z - this.z); }

  /** Climb in (needs you within reach; not while it's upside down). */
  board(player) {
    if (this.capsized || this.aboard || this.dist(player.position) > BOAT.reach) return false;
    this.state = 'aboard'; this.righting = 0;
    this.trace('boarded', { at: [+this.x.toFixed(1), +this.z.toFixed(1)] });
    this.notify('In the boat. Space starts the outboard, W throttle, S reverse, A/D steer, E to get out.');
    this.seat(player);
    return true;
  }

  /** Get out: onto footing beside the boat if there is any, otherwise over the side into the water. */
  leave(player) {
    if (!this.aboard) return null;
    this.state = 'adrift'; this.engine = false; this.throttle = 0; this.speed = 0;
    const spot = this.footingBeside();
    const to = spot ?? this.sidePoint(2.2, 1);
    player.position.set(to.x, 0, to.z); player.velocity?.set(0, 0, 0);
    const how = spot ? 'stepped ashore' : 'over the side';
    this.trace('left', { how, at: [+to.x.toFixed(1), +to.z.toFixed(1)] });
    return how;
  }

  sidePoint(d, side) { return { x: this.x + Math.cos(this.heading) * d * side, z: this.z - Math.sin(this.heading) * d * side }; }
  /** Nearest dry (or wadeable) spot within a short step of the hull: sides, bow, stern. */
  footingBeside() {
    const c = [];
    for (const d of [2, 3, 4]) {
      c.push(this.sidePoint(d, 1), this.sidePoint(d, -1));
      c.push({ x: this.x - Math.sin(this.heading) * (d + 1), z: this.z - Math.cos(this.heading) * (d + 1) });
      c.push({ x: this.x + Math.sin(this.heading) * (d + 1), z: this.z + Math.cos(this.heading) * (d + 1) });
    }
    return c.find((p) => this.footingAt(p.x, p.z) === 'dry') ?? c.find((p) => this.footingAt(p.x, p.z) === 'shallow') ?? null;
  }

  setEngine(on) {
    if (!this.aboard) return false;
    if (on && this.tank.fuel <= 0) { this.notify('The outboard coughs and won\'t start: the tank is empty. Paddle (W) for the shore.'); this.trace('engine', { on: false, why: 'no fuel' }); return false; }
    if (this.engine === on) return true;
    this.engine = on; this.trace('engine', { on, fuel: +this.tank.fuel.toFixed(3) });
    return true;
  }

  /** Something bumps the hull from below (a creature, a rock): it heels hard. */
  bump(strength = 1, from = 'below') {
    if (this.capsized) return;
    this.tilt += BOAT.bumpHeel * strength; this.bumpedAt = this.time; this.heelSide = Math.sin(this.time * 7.3) >= 0 ? 1 : -1;
    this.trace('bumped', { from, tilt: +this.tilt.toFixed(2) });
    if (this.aboard) this.notify('Something hits the hull from below. The boat heels hard!');
  }

  capsize(player, why) {
    const wasAboard = this.aboard;
    this.state = 'capsized'; this.engine = false; this.throttle = 0; this.speed = 0; this.tilt = 0; this.righting = 0;
    this.capsizes++;
    this.trace('capsized', { why, at: [+this.x.toFixed(1), +this.z.toFixed(1)] });
    if (wasAboard) {
      const to = this.sidePoint(2.4, this.heelSide);
      player.position.set(to.x, 0, to.z); player.velocity?.set(0, 0, 0);
      this.notify('The boat goes over! You\'re in the water. Swim to the hull and hold E to right it, or swim for the shore.');
    }
  }

  seat(player) { player.position.set(this.x, BOAT.seat, this.z); player.velocity?.set(0, 0, 0); }

  /** keys: Set of held key codes. holdUse: E is held this step (righting). */
  update(dt, { keys = new Set(), player, holdUse = false } = {}) {
    this.time += dt;
    const storm = this.storm();
    if (this.aboard) {
      this.throttle = keys.has('KeyW') ? 1 : keys.has('KeyS') ? -BOAT.reverse : 0;
      this.turnInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
      const powered = this.engine && this.tank.fuel > 0;
      const want = powered ? BOAT.speed * this.throttle : BOAT.paddle * Math.sign(this.throttle);
      this.speed += Math.sign(want - this.speed) * Math.min(Math.abs(want - this.speed), BOAT.accel * dt);
      if (powered && this.throttle !== 0) {
        this.tank.fuel = Math.max(0, this.tank.fuel - BOAT.fuelPerSec * Math.abs(this.throttle) * (1 + 0.5 * storm) * dt);
        if (this.tank.fuel <= 0) { this.engine = false; this.trace('engine', { on: false, why: 'out of fuel' }); this.notify('The outboard coughs and dies: out of fuel. You can paddle (W), slowly.'); }
      }
      // Turning rate grows with way on (a boat can't spin in place), up to BOAT.turn.
      const way = Math.min(1, 0.35 + Math.abs(this.speed) / BOAT.speed);
      this.heading += this.turnInput * BOAT.turn * way * dt;
      // Heel: hard turns at speed lean the hull over (outward); it settles back on its own.
      const sp = Math.abs(this.speed) / BOAT.speed;
      if (this.turnInput) { this.tilt += BOAT.heelTurn * sp * sp * dt; this.heelSide = -this.turnInput; }
    } else {
      this.speed *= Math.max(0, 1 - 1.5 * dt);
    }
    if (!this.capsized) {
      // Storm waves rock it (a deterministic swell), more when beam-on and moving.
      const wave = storm > 0 ? BOAT.waveHeel * storm * Math.max(0, Math.sin(this.time * 0.9) * Math.sin(this.time * 2.3 + 1)) : 0;
      this.tilt = Math.max(0, this.tilt - this.tilt * BOAT.settle * dt);
      this.heel = this.tilt + wave;
      if (this.heel >= BOAT.capsizeAt) this.capsize(player, this.time - (this.bumpedAt ?? -99) < 1.5 ? 'bumped from below' : this.aboard ? (wave > 0.05 ? 'a wave caught it heeled over' : 'turned too hard at speed') : 'swamped');
      else if (this.aboard && this.heel > 0.7 && !this.warned) { this.warned = true; this.notify('The boat is heeling hard: ease off the turn or the throttle!'); }
      if (this.heel < 0.5) this.warned = false;
    } else this.heel = 0;
    // Move the hull: under way, or drifting in the storm.
    let nx = this.x - Math.sin(this.heading) * this.speed * dt, nz = this.z - Math.cos(this.heading) * this.speed * dt;
    if (storm > 0 && this.state !== 'moored') { nx += BOAT.stormDrift * storm * dt; nz += 0.4 * BOAT.stormDrift * storm * dt; }
    if (this.isWater(nx, nz)) { this.x = nx; this.z = nz; } else if (this.aboard) this.speed *= 0.3;   // ran aground: stops short
    // Righting the capsized hull: hold E while swimming beside it.
    if (this.capsized && player) {
      if (holdUse && this.dist(player.position) <= BOAT.rightReach) {
        this.righting += dt;
        if (this.righting >= BOAT.rightTime) {
          this.state = 'adrift'; this.righting = 0;
          this.trace('righted', {});
          this.notify('You heave the boat back over. Climb in (E). The engine is cold and wet; it should still start.');
        }
      } else this.righting = Math.max(0, this.righting - dt);
    }
    if (this.aboard && player) this.seat(player);
    this.place();
  }
}

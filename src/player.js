import * as THREE from 'three';
import { groundAt } from './maps/ground.js';

// Tunables (metres, seconds).
export const PLAYER = {
  radius: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.0,
  eyeOffset: 0.12,       // eye is this far below the top of the body
  walkSpeed: 3.2,
  sprintSpeed: 6.0,
  crouchSpeed: 1.6,
  accel: 14,             // ground acceleration toward target speed
  gravity: 20,
  crouchLerp: 10,        // how fast the camera drops/rises
  stepHeight: 0.36,      // ledges up to this tall (boardwalks, stairs) are stepped onto
  mouseSens: 0.0022,
  // Stamina (0..1).
  staminaDrain: 1 / 6,       // full bar lasts 6 s of sprinting
  staminaRegenMove: 0.12,    // per second while walking/crouch-walking
  staminaRegenRest: 0.3,     // per second while standing still
  staminaRegenDelay: 0.8,    // pause after sprinting before refilling starts
  staminaRecover: 0.3,       // once emptied, sprint is locked until this much is back
  // Noise (0..1) the player makes each tick; cryptid AI reads player.noise / player.noiseRadius.
  noiseCrouch: 0.15,
  noiseWalk: 0.45,
  noiseSprint: 1.0,
  noiseMaxRadius: 20,        // metres a full-volume (1.0) noise carries
  noiseRise: 12,             // how fast noise follows a louder gait
  noiseFall: 4,              // how fast it fades when you go quieter/stop
  maxPitch: Math.PI / 2 - 0.01,
};

// First-person controller: WASD, mouse look, sprint (Shift), crouch (Ctrl/C).
// Body is an axis-aligned box (feet at position.y) resolved per-axis against AABB colliders.
export class Player {
  constructor(camera, input, colliders) {
    this.camera = camera;
    this.input = input;
    this.colliders = colliders;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = PLAYER.standHeight;   // current collision height
    this.eyeHeight = PLAYER.standHeight - PLAYER.eyeOffset; // smoothed camera height
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    // Optional map hook: (x, z, feetY) => speed multiplier (e.g. wading in water slows you).
    this.speedAt = null;
    this.speedFactor = 1;
    this.stamina = 1;
    this.recoveryScale = 1;    // stamina recovery multiplier, set by the survival systems (GDD 2.8)
    this.loadSpeed = 1;        // carried-load speed multiplier, floor 0.45 (set by the pack, #69)
    this.loadFactor = 1;       // carried-load exertion multiplier on stamina cost
    this.injuryPenalty = 0;    // 0..1 from wounds (set by S08 via survival, #83)
    this.thermalPenalty = 0;   // 0..1 from cold (set by S02 via survival, #83)
    this.terrainFactor = 1;    // exertion multiplier for the ground underfoot (water costs more)
    this.lookScale = 1;        // look sensitivity multiplier (settings)
    this.invertY = false;      // invert vertical look (settings)
    this.readingMap = false;   // map and compass raised (#70): walk slowly, no sprint
    this.exhausted = false;   // hit 0 and hasn't recovered enough to sprint again
    this.sinceSprint = 99;
    this.noise = 0;           // 0 silent .. 1 sprinting
    this.noiseRadius = 0;     // metres the current noise carries
    camera.rotation.order = 'YXZ';
  }

  update(dt) {
    const inp = this.input;

    // Look.
    const [dx, dy] = inp.consumeMouse();
    // Look sensitivity and invert (settings, #76) apply to mouse and gamepad alike.
    const sens = PLAYER.mouseSens * this.lookScale;
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens * (this.invertY ? -1 : 1), -PLAYER.maxPitch, PLAYER.maxPitch);

    // Crouch: held. Standing up is blocked if something is overhead.
    const wantCrouch = inp.down('ControlLeft', 'ControlRight', 'KeyC');
    if (wantCrouch) {
      this.crouching = true;
    } else if (this.crouching && this.canStand()) {
      this.crouching = false;
    }
    this.height = this.crouching ? PLAYER.crouchHeight : PLAYER.standHeight;

    // Move direction on the ground plane.
    const f = (inp.down('KeyW', 'ArrowUp') ? 1 : 0) - (inp.down('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (inp.down('KeyD', 'ArrowRight') ? 1 : 0) - (inp.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const wish = new THREE.Vector3(r, 0, -f);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Ground under the feet can slow you (water); you can't sprint while slowed.
    this.speedFactor = this.speedAt ? this.speedAt(this.position.x, this.position.z, this.position.y) : 1;
    // exertion_cost = action * load * terrain (GDD 2.8): wading is hard work.
    this.terrainFactor = this.speedFactor >= 1 ? 1 : 1 + (1 - this.speedFactor) * 1.5;
    // Sprint only while moving forward, not crouched and not slowed.
    // Stamina gates sprinting; emptying it locks sprint until it partly refills.
    this.sprinting = !this.readingMap && !this.crouching && f > 0 && this.speedFactor >= 1 && inp.down('ShiftLeft', 'ShiftRight') && !this.exhausted;
    this.updateStamina(dt, wish.lengthSq() > 0);
    // Carried load (#69, GDD 2.8): movement_speed = action_speed * max(0.45, 1 - load_penalty).
    // GDD 2.8: movement_speed = speed * max(0.45, 1 - load - injury - thermal) (one combined floor).
    this.capability = Math.max(0.45, this.loadSpeed - this.injuryPenalty - this.thermalPenalty);
    const speed = this.speedFactor * this.capability * (this.readingMap ? 0.5 : 1) *   // reading the map: slow walk (#70)
      (this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed);

    const k = 1 - Math.exp(-PLAYER.accel * dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * k;
    this.velocity.z += (wish.z * speed - this.velocity.z) * k;
    this.velocity.y -= PLAYER.gravity * dt;

    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    const wasOnTerrain = this.onTerrain;
    this.grounded = false;
    this.moveAxis('y', this.velocity.y * dt);
    // Terrain floor (flat y = 0 unless the map carves it, e.g. the forest's sunken trail ruts).
    // While walking on the terrain the feet follow it down into a rut instead of dropping in.
    const floor = groundAt(this.position.x, this.position.z);
    this.onTerrain = false;
    if (this.position.y <= floor || (wasOnTerrain && this.velocity.y <= 0 && this.position.y - floor < 0.25)) {
      this.position.y = floor; this.velocity.y = 0; this.grounded = true; this.onTerrain = true;
    }
    this.updateNoise(dt, speed);

    // Camera.
    const targetEye = this.height - PLAYER.eyeOffset;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-PLAYER.crouchLerp * dt));
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  // Gait sets the noise level, scaled by how fast you're actually going (walking into a wall is quiet).
  updateNoise(dt, gaitSpeed) {
    const gait = this.crouching ? PLAYER.noiseCrouch : this.sprinting ? PLAYER.noiseSprint : PLAYER.noiseWalk;
    const moving = Math.hypot(this.velocity.x, this.velocity.z);
    const target = gait * Math.min(1, moving / gaitSpeed);
    const rate = target > this.noise ? PLAYER.noiseRise : PLAYER.noiseFall;
    this.noise += (target - this.noise) * (1 - Math.exp(-rate * dt));
    if (this.noise < 0.005) this.noise = 0;
    this.noiseRadius = this.noise * PLAYER.noiseMaxRadius;
    // A one-off loud sound you make on purpose (signal whistle, #87): louder and further than any gait.
    const b = this.noiseBurst;
    if (b && b.left > 0) { b.left -= dt; this.noise = Math.max(this.noise, b.level); this.noiseRadius = Math.max(this.noiseRadius, b.radius); }
    // Your breathing when dread has you (#132, S14): a real sound creatures can hear, even standing still.
    const br = this.breathNoise;
    if (br && br.level > 0) { this.noise = Math.max(this.noise, br.level); this.noiseRadius = Math.max(this.noiseRadius, br.radius); }
  }

  // How loud the player is at a world position: 0 (out of earshot) .. noise (right next to them).
  noiseAt(pos) {
    if (this.noiseRadius <= 0) return 0;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    return Math.max(0, this.noise * (1 - d / this.noiseRadius));
  }

  /** GDD 2.8: stamina_capacity = base * max(0.50, 1 - fatigue - injury) (fatigue: S09, #104). */
  get staminaCap() { return Math.max(0.5, 1 - (this.fatiguePenalty ?? 0) - this.injuryPenalty); }

  updateStamina(dt, moving) {
    if (this.stamina > this.staminaCap) this.stamina = this.staminaCap;
    if (this.sprinting) {
      this.sinceSprint = 0;
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * this.loadFactor * this.terrainFactor * dt);   // exertion_cost = cost * load * terrain
      if (this.stamina === 0) { this.exhausted = true; this.sprinting = false; }
    } else {
      this.sinceSprint += dt;
      if (this.sinceSprint >= PLAYER.staminaRegenDelay) {
        // Hunger/cold slow recovery (survival); hauling a load while walking is exertion too.
        const rate = (moving ? PLAYER.staminaRegenMove / (this.loadFactor * this.terrainFactor) : PLAYER.staminaRegenRest) * this.recoveryScale;
        this.stamina = Math.min(this.staminaCap, this.stamina + rate * dt);
      }
      if (this.exhausted && this.stamina >= PLAYER.staminaRecover) this.exhausted = false;
    }
  }

  bodyBox(pos = this.position, height = this.height, out = new THREE.Box3()) {
    const r = PLAYER.radius;
    out.min.set(pos.x - r, pos.y, pos.z - r);
    out.max.set(pos.x + r, pos.y + height, pos.z + r);
    return out;
  }

  canStand() {
    const box = this.bodyBox(this.position, PLAYER.standHeight);
    box.min.y += 0.01;
    return !this.colliders.some((c) => c.intersectsBox(box));
  }

  // Walking into a low ledge: lift onto it if there's room, instead of being blocked.
  tryStepUp(c) {
    const rise = c.max.y - this.position.y;
    if (rise <= 0 || rise > PLAYER.stepHeight || this.velocity.y > 0.5) return false;
    const lifted = this.bodyBox(new THREE.Vector3(this.position.x, c.max.y + 1e-3, this.position.z));
    if (this.colliders.some((o) => o.intersectsBox(lifted))) return false;
    this.position.y = c.max.y + 1e-3;
    this.velocity.y = 0;
    return true;
  }

  // Move along one axis, then push out of any overlapping collider along that axis.
  moveAxis(axis, delta) {
    if (delta === 0) return;
    this.position[axis] += delta;
    const box = this.bodyBox();
    // Shrink slightly on the other axes so touching faces don't count as overlap.
    const eps = 1e-4;
    for (const c of this.colliders) {
      const b = box.clone();
      for (const a of ['x', 'y', 'z']) if (a !== axis) { b.min[a] += eps; b.max[a] -= eps; }
      if (!c.intersectsBox(b)) continue;
      if (axis !== 'y' && this.tryStepUp(c)) { this.bodyBox(this.position, this.height, box); continue; }
      if (delta > 0) this.position[axis] -= (b.max[axis] + eps) - c.min[axis];
      else this.position[axis] += c.max[axis] - (b.min[axis] - eps);
      if (axis === 'y') {
        if (delta < 0) this.grounded = true;
        this.velocity.y = 0;
      } else {
        this.velocity[axis] = 0;
      }
      this.bodyBox(this.position, this.height, box);
    }
  }
}

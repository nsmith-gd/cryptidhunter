import * as THREE from 'three';

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
    this.stamina = 1;
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
    this.yaw -= dx * PLAYER.mouseSens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * PLAYER.mouseSens, -PLAYER.maxPitch, PLAYER.maxPitch);

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

    // Sprint only while moving forward and not crouched.
    // Stamina gates sprinting; emptying it locks sprint until it partly refills.
    this.sprinting = !this.crouching && f > 0 && inp.down('ShiftLeft', 'ShiftRight') && !this.exhausted;
    this.updateStamina(dt, wish.lengthSq() > 0);
    const speed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    const k = 1 - Math.exp(-PLAYER.accel * dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * k;
    this.velocity.z += (wish.z * speed - this.velocity.z) * k;
    this.velocity.y -= PLAYER.gravity * dt;

    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    this.grounded = false;
    this.moveAxis('y', this.velocity.y * dt);
    if (this.position.y <= 0) { this.position.y = 0; this.velocity.y = 0; this.grounded = true; }
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
  }

  // How loud the player is at a world position: 0 (out of earshot) .. noise (right next to them).
  noiseAt(pos) {
    if (this.noiseRadius <= 0) return 0;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    return Math.max(0, this.noise * (1 - d / this.noiseRadius));
  }

  updateStamina(dt, moving) {
    if (this.sprinting) {
      this.sinceSprint = 0;
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      if (this.stamina === 0) { this.exhausted = true; this.sprinting = false; }
    } else {
      this.sinceSprint += dt;
      if (this.sinceSprint >= PLAYER.staminaRegenDelay) {
        const rate = moving ? PLAYER.staminaRegenMove : PLAYER.staminaRegenRest;
        this.stamina = Math.min(1, this.stamina + rate * dt);
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

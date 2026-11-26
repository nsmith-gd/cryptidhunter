import * as THREE from 'three';

// Bigfoot's procedural body (#78). Director: "animations code driven with the body, the way Rain
// World does it": the clips (bigfootAnim.js) only set the gait timing and the personality (lean,
// breathing, arm swing, fidgets); this layer then makes the body physical, every frame:
//
//  · Planted feet. Each foot is a point in the world. While it bears weight it stays put (no
//    sliding, whatever the body does); it lifts and swings forward on its own arc at the gait's
//    step timing, aiming where the hip will be by mid-stance. Turning, stopping and starting move
//    the targets, so steps adapt instead of replaying a cycle. When standing, a foot that ended up
//    out of place takes a small settling step.
//  · Two-bone leg IK reaches each foot from the hip: knees bend as needed, the sole stays flat
//    (toe-off and heel-strike tip it a little). If a foot is out of reach the hips sink to it.
//  · Weight transfer: the hips drift over the foot that's bearing weight.
//  · Inertia: the torso, head and arms lag behind acceleration and lean into turns on springs.
//  · Targeting: when he has something to look at (you, a noise), the look is spread down the
//    spine, chest and neck, each joint on its own spring, so the head leads and the body follows.
//
// Works in the game (the root moves through the world) and in the animation viewer (the root
// stays put: the ground is treated as a treadmill moving at the given speed).

const v3 = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;

// ---- Move behaviours (#79): the set of ways this character moves -------------------------------
// Each behaviour state maps to a move; a move is a set of body parameters the procedural layer
// blends between on springs, so changes of mood flow from one way of moving into the next.
//   lumber  walking about: wide heavy stance, hips roll over the weight-bearing foot, shoulders
//           roll against them, a heavy heel plant you can see go through the body
//   shift   standing: slow rock from foot to foot, deep heaving breaths, shuffle-turns in place
//   loom    watching / warning you: draws up to full height, back straight, chest swollen, arms
//           hung wide with claws out, head lowered to stare from under the brow, slow sway
//   stalk   following you: crouched low, high deliberate knee lifts, quiet light plants
//   search  investigating a noise: stooped, head down and forward, careful steps
//   charge  running at you / running: pounding plants, arms wide, low head
//   bolt    fleeing: long fast strides, light, upright head to glance back
// width: stance x rest width · sway: hip shift over the stance foot · roll: shoulder counter-roll
// dip: heel-plant drop · lift: foot lift x · mass: 0 light .. 1 heavy (slower body springs)
// rise: back straightened (+) / hips lowered (-) · spread: arms out · headDrop: head lowered · heave: breathing
export const MOVES = Object.freeze({
  lumber: { width: 1.2, sway: 0.6, roll: 0.16, dip: 0.07, lift: 1.0, mass: 0.85, rise: 0, spread: 0.1, headDrop: 0.08, heave: 0.5 },
  shift: { width: 1.25, sway: 0.55, roll: 0.08, dip: 0.04, lift: 0.7, mass: 0.85, rise: 0, spread: 0.08, headDrop: 0.06, heave: 1 },
  loom: { width: 1.35, sway: 0.35, roll: 0.06, dip: 0.04, lift: 0.7, mass: 0.9, rise: 0.22, spread: 0.38, headDrop: 0.2, heave: 1.4 },
  stalk: { width: 1.3, sway: 0.4, roll: 0.08, dip: 0.015, lift: 1.9, mass: 0.7, rise: -0.12, spread: 0.2, headDrop: 0.12, heave: 0.3 },
  search: { width: 1.15, sway: 0.35, roll: 0.06, dip: 0.03, lift: 1.25, mass: 0.75, rise: -0.06, spread: 0.12, headDrop: 0.24, heave: 0.5 },
  charge: { width: 1.1, sway: 0.3, roll: 0.14, dip: 0.11, lift: 1.6, mass: 0.7, rise: 0, spread: 0.26, headDrop: 0.06, heave: 0.2 },
  bolt: { width: 1.0, sway: 0.2, roll: 0.1, dip: 0.06, lift: 1.5, mass: 0.5, rise: 0, spread: 0.08, headDrop: -0.04, heave: 0.1 },
});
/** Which move a behaviour state and speed plays. */
export function moveFor(state, speed) {
  if (state === 'flee') return 'bolt';
  if (state === 'shadow') return 'stalk';
  if (state === 'investigate') return speed < 0.25 ? 'shift' : 'search';
  if (state === 'observe' || state === 'warn' || state === 'aggress') return speed > 2.6 ? 'charge' : 'loom';
  return speed < 0.25 ? 'shift' : speed < 2.6 ? 'lumber' : 'charge';
}

export function createBigfootBody(root, body, bones, animator, { worldScale = 1 } = {}) {
  const S = worldScale;                                          // rig units -> metres
  const l1 = Math.abs(bones.shinL.position.y), l2 = Math.abs(bones.footL.position.y);
  const ankleY = bones.hips.position.y + bones.thighL.position.y - l1 - l2;   // ankle height at rest (rig)
  const legs = ['L', 'R'].map((side) => {
    const s = side === 'L' ? -1 : 1;
    const restX = bones[`thigh${side}`].position.x;
    return { side, s, restX, foot: new THREE.Vector3(restX, ankleY, 0), from: new THREE.Vector3(), swing: 0, swinging: false, settle: 0, lift: 0 };
  });

  // Springs (critically damped), per named channel.
  const springs = new Map();
  const spring = (name, target, freq, dt) => {
    let sp = springs.get(name);
    if (!sp) { sp = { x: target, v: 0 }; springs.set(name, sp); }
    if (dt <= 0) return sp.x;
    const w = freq, e = Math.exp(-w * dt), d = sp.x - target;
    sp.x = target + (d + (sp.v + w * d) * dt) * e;
    sp.v = (sp.v - w * (sp.v + w * d) * dt) * e;
    return sp.x;
  };

  const lastPos = v3().copy(root.position);
  let lastYaw = root.rotation.y, first = true;
  const vel = v3(), velPrev = v3(), acc = v3();
  let yawRate = 0, lastPhase = animator.phase, settleClock = 0;
  const tmp = v3(), tmp2 = v3(), world = v3();
  const api = { enabled: true, legs, look: null, move: 'shift', stats: { reach: 0, plants: 0 } };
  const mv = { ...MOVES.shift };                                 // blended move parameters
  let clock = 0;

  /** World point -> rig space (the scaled body group's local frame). */
  const toRig = (p, out) => body.worldToLocal(out.copy(p));

  api.update = (dt, speed, state) => {
    if (!api.enabled || dt <= 0) return;
    root.updateMatrixWorld(true);
    clock += dt;
    api.move = moveFor(state, speed);
    const want = MOVES[api.move];
    for (const k of Object.keys(mv)) mv[k] = spring(`mv.${k}`, want[k], 2.2, dt);   // moods flow into each other
    const massK = lerp(1.15, 0.55, mv.mass);                     // heavier = slower, laggier body springs
    // ---- how the body moved this frame (in the root's frame), or the treadmill in the viewer ----
    const dWorld = tmp.copy(root.position).sub(lastPos);
    let dyaw = first ? 0 : Math.atan2(Math.sin(root.rotation.y - lastYaw), Math.cos(root.rotation.y - lastYaw));
    let dLocal;
    if (first) dLocal = v3();
    else if (dWorld.lengthSq() > 1e-10) dLocal = dWorld.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -lastYaw).divideScalar(S);   // in last frame's axes
    else dLocal = v3().set(0, 0, -(speed * dt) / S);                 // treadmill: walking in place
    first = false;
    lastPos.copy(root.position); lastYaw = root.rotation.y;
    // Planted points are fixed in the world: shift them back by the body's motion and turn.
    const cy = Math.cos(-dyaw), sy = Math.sin(-dyaw);
    // World-fixed point into the new body frame: p' = Ry(-dyaw) (p - d).
    const toBody = (p) => { const x = p.x - dLocal.x, z = p.z - dLocal.z; p.x = x * cy + z * sy; p.z = -x * sy + z * cy; };
    velPrev.copy(vel);
    vel.set(dLocal.x / dt, 0, dLocal.z / dt);
    acc.lerp(tmp2.subVectors(vel, velPrev).divideScalar(dt), Math.min(1, dt * 6));
    yawRate = lerp(yawRate, dyaw / dt, Math.min(1, dt * 6));

    // ---- feet: step timing from the clip's gait phase, targets from where the body is going ----
    const phase = animator.phase;
    const moving = speed > 0.25;
    const rate = ((phase - lastPhase + TAU) % TAU) / dt;              // radians of gait per second
    lastPhase = phase;
    const cycle = rate > 1e-3 ? TAU / rate : Infinity;                // seconds per two steps
    // Stance: as long as possible (up to 60% of the cycle, a walk) but never longer than a planted
    // foot can be swept under the hip at this speed (fast gaits get a flight phase).
    const maxSweep = 0.9 * (l1 + l2);                                   // rig units
    const sweepTime = speed > 0.05 ? (maxSweep * S) / speed : Infinity;
    const stanceFrac = isFinite(cycle) ? clamp(sweepTime / cycle, 0.25, 0.6) : 0.6;
    const swingFrac = 1 - stanceFrac;
    const stanceTime = stanceFrac * cycle;
    for (const L of legs) {
      toBody(L.foot);
      if (L.swinging || L.settle) toBody(L.from);
      // Where the foot should land: ahead of the hip by half a stance's travel, turned with the body.
      const home = tmp2.set(L.restX * mv.width, ankleY, 0);
      if (moving && isFinite(cycle)) home.addScaledVector(vel, stanceTime * 0.5);      // lands ahead, leaves behind
      if (Math.abs(yawRate) > 0.05) { const a = yawRate * 0.18, c = Math.cos(a), s = Math.sin(a); const x = home.x * c + home.z * s, z = -home.x * s + home.z * c; home.x = x; home.z = z; }
      // The leg's own gait position: 0..1, swinging during [0.04, 0.04 + swingFrac).
      const legPhase = (((phase + Math.PI / 2 + (L.s > 0 ? Math.PI : 0)) / TAU) % 1 + 1) % 1;
      const inSwing = moving && legPhase >= 0.04 && legPhase < 0.04 + swingFrac;
      if (inSwing) {
        if (!L.swinging) { L.swinging = true; L.from.copy(L.foot); }
        const u = clamp((legPhase - 0.04) / swingFrac, 0, 1);
        const e = u * u * (3 - 2 * u);
        L.foot.lerpVectors(L.from, home, e);
        L.lift = Math.sin(Math.PI * u) * (0.06 + 0.06 * clamp(speed / 5, 0, 1)) * mv.lift / (S / 1.55);
        L.foot.y = ankleY + L.lift;
        L.swing = u;
      } else {
        if (L.swinging) {
          L.swinging = false; L.foot.y = ankleY; L.lift = 0;
          // Heel plant: the weight lands and drops through the body (a kick on the plant spring).
          const sp = springs.get('plant'); if (sp) sp.v -= mv.dip * (6 + speed * 1.2);
          api.stats.plants++;
        }
        // Standing still: a foot well out of place takes a small settling step (one at a time).
        if (!moving) {
          const off = Math.hypot(L.foot.x - home.x, L.foot.z - home.z);
          if (L.settle > 0) {
            L.settle = Math.min(1, L.settle + dt / 0.45);
            const e = L.settle * L.settle * (3 - 2 * L.settle);
            L.foot.x = lerp(L.from.x, home.x, e); L.foot.z = lerp(L.from.z, home.z, e);
            L.foot.y = ankleY + Math.sin(Math.PI * L.settle) * 0.05;
            if (L.settle >= 1) { L.settle = 0; L.foot.y = ankleY; settleClock = 0.25; }
          } else if (off > (Math.abs(yawRate) > 0.3 ? 0.05 : 0.12) && settleClock <= 0 && !legs.some((o) => o.settle > 0)) {   // shuffle-turn
            L.settle = 1e-4; L.from.copy(L.foot);
          }
        } else L.settle = 0;
      }
    }
    settleClock = Math.max(0, settleClock - dt);

    // ---- weight transfer: hips drift over the foot bearing weight ----
    const support = legs.filter((L) => !L.swinging && !L.settle);
    const restX = legs[1].restX;
    let overX = support.length === 1 ? support[0].foot.x * mv.sway : 0;
    if (speed < 0.25 && !legs.some((L) => L.settle)) overX = Math.sin(clock * TAU / 5.5) * restX * mv.sway * 0.8;   // slow rock, foot to foot
    const hipsX = spring('hipsX', overX, 6 * massK, dt);
    bones.hips.position.x = hipsX;
    const rollK = hipsX / Math.max(1e-3, restX);                          // -1..1: which foot he's over
    bones.hips.rotation.z += rollK * mv.roll * 0.5;                        // pelvis drops over the free leg
    bones.spine.rotation.z -= rollK * mv.roll * 0.6;                       // shoulders roll against the hips
    bones.chest.rotation.z -= rollK * mv.roll * 0.5;
    const plant = spring('plant', 0, 7, dt);                               // heel-plant drop (kicked on landing)
    bones.hips.position.y += plant * 0.5;
    bones.chest.rotation.x += plant * 0.6;                                 // the chest jolts forward and down
    bones.neck.rotation.x -= plant * 0.4;
    // Posture for the move: rise up / sink low, arms hung wide, head lowered, slow heaving breaths.
    const breath = Math.sin(clock * TAU / 4.2);
    if (mv.rise > 0) { bones.spine.rotation.x += mv.rise; bones.chest.rotation.x += mv.rise * 0.4; bones.neck.rotation.x -= mv.rise * 0.6; }
    else bones.hips.position.y += mv.rise;
    bones.chest.rotation.x -= breath * 0.03 * mv.heave;
    bones.neck.rotation.x += mv.headDrop + breath * 0.01 * mv.heave;

    // ---- inertia and turning (springs) ----
    const accZ = clamp(acc.z, -12, 12), accX = clamp(acc.x, -12, 12);
    const leanBack = spring('leanBack', accZ * 0.014, 6 * massK, dt);          // speeding up (acc.z < 0 = forward) -> lags back
    const bank = spring('bank', -yawRate * 0.07 + accX * 0.01, 5 * massK, dt);
    bones.spine.rotation.x += leanBack * 0.6;
    bones.chest.rotation.x += leanBack * 0.5;
    bones.spine.rotation.z += bank * 0.5;
    bones.chest.rotation.z += bank * 0.4;
    for (const L of legs) {
      const arm = bones[`upperArm${L.side}`];
      arm.rotation.x += spring(`armLag${L.side}`, -accZ * 0.025, 7 * massK, dt);  // heavy arms drag behind a surge
      arm.rotation.z += L.s * (mv.spread + breath * 0.02 * mv.heave);       // hung wide (loom, charge)
      arm.rotation.z += spring(`armOut${L.side}`, L.s * Math.max(0, -yawRate * L.s) * 0.05, 6, dt);
    }

    // ---- targeting: spread the look down the spine (head leads, body follows) ----
    const look = root.userData.look;
    const lw = spring('lookW', look?.target ? clamp(look.weight ?? 1, 0, 1) : 0, 4, dt);
    if (lw > 1e-3 && look?.target) api.look = look.target;
    if (lw > 1e-3 && api.look) {
      const t = toRig(api.look, tmp);
      const headY = bones.hips.position.y + 1.2;
      let yaw = Math.atan2(-t.x, -t.z), pitch = Math.atan2(t.y - headY, Math.hypot(t.x, t.z));
      yaw = clamp(yaw, -1.5, 1.5); pitch = clamp(pitch, -0.6, 0.5);
      const sYaw = spring('tSpine', yaw * 0.18, 3.5, dt), cYaw = spring('tChest', yaw * 0.27, 5, dt), nYaw = spring('tNeck', yaw * 0.55, 8, dt);
      const nPitch = spring('tPitch', pitch, 7, dt);
      bones.spine.rotation.y = lerp(bones.spine.rotation.y, sYaw, lw);
      bones.chest.rotation.y = lerp(bones.chest.rotation.y, cYaw, lw);
      bones.neck.rotation.y = lerp(bones.neck.rotation.y, nYaw, lw);
      bones.neck.rotation.x -= nPitch * 0.8 * lw;
    } else { spring('tSpine', 0, 3.5, dt); spring('tChest', 0, 5, dt); spring('tNeck', 0, 8, dt); spring('tPitch', 0, 7, dt); }

    // ---- legs: hips sink if a foot is out of reach, then two-bone IK to each foot ----
    body.updateMatrixWorld(true);
    let need = 0;
    for (const L of legs) {
      const hip = bones[`thigh${L.side}`].getWorldPosition(world);
      const hipRig = toRig(hip, tmp2);
      need = Math.max(need, hipRig.distanceTo(L.foot) - (l1 + l2) * 0.985);
    }
    if (need > 0) { bones.hips.position.y -= need; body.updateMatrixWorld(true); }
    api.stats.reach = Math.max(0, need);
    for (const L of legs) solveLeg(L);
  };

  const target = v3(), local = v3();
  function solveLeg(L) {
    const hips = bones.hips, thigh = bones[`thigh${L.side}`], shin = bones[`shin${L.side}`], foot = bones[`foot${L.side}`];
    // Foot target into the hips' frame, relative to the hip joint.
    body.localToWorld(target.copy(L.foot));
    hips.worldToLocal(local.copy(target)).sub(thigh.position);
    const d = local;
    const lateral = Math.atan2(d.x, Math.max(0.05, -d.y));
    const r = clamp(d.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 1e-4);
    const sag = Math.atan2(-d.z, Math.hypot(d.y, d.x));
    const hipOff = Math.acos(clamp((l1 * l1 + r * r - l2 * l2) / (2 * l1 * r), -1, 1));
    const knee = Math.acos(clamp((l1 * l1 + l2 * l2 - r * r) / (2 * l1 * l2), -1, 1));
    thigh.rotation.set(sag + hipOff, 0, lateral);
    shin.rotation.set(-(Math.PI - knee), 0, 0);
    // Sole flat on the ground, tipping a little at toe-off and heel-strike while it swings.
    const tip = L.swinging ? Math.sin(TAU * L.swing) * 0.35 : 0;
    foot.rotation.set(-(thigh.rotation.x + shin.rotation.x) + tip, 0, -lateral);
  }

  /** World position of each foot (for checks). */
  api.feetWorld = () => legs.map((L) => ({ side: L.side, planted: !L.swinging && !L.settle, p: body.localToWorld(L.foot.clone()) }));
  return api;
}

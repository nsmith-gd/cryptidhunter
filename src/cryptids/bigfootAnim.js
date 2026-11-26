import * as THREE from 'three';

// Bigfoot animation set (#43), driven procedurally on the bone rig from bigfootModel.js.
//
// Clips (what the player sees)            Behaviour states that play them (cryptidAI.js)
//   idle        breathing, slow look-around   roam (standing still), observe/warn/aggress when still
//   walk        heavy, long-armed amble       roam (moving)
//   run         deep lean, pumping arms        roam (fast)
//   flee        sprint + glances back          flee
//   investigate low careful steps, scan, sniff  investigate
//   prowl       crouched creep, head locked    shadow (following you)
//   stare       rears up, locks on, claws out  observe, warn, aggress
//   knock       one-shot: crouch + draw back, rear up, club the trunk, overshoot, settle
//
// How it reads as heavy: foot plants dip the hips and jolt the chest at contact; the chest and
// arms lag the hips by a fraction of a step (torso lag), the shoulders sway against the hips,
// the head counter-rotates to stay level (a predator's steady gaze).
// Seamless loops: walk/run/flee/investigate/prowl depend only on the stride phase, idle only on
// a clock that wraps every IDLE_PERIOD seconds (every idle frequency is a whole multiple of it).
// Fluid, personality-driven motion (director, #43 review): poses evaluate every frame by default
// (POSE_FPS = 0). Secondary motion rides on top: the head and arms follow through on springs
// (overlap on starts, stops and turns), and idle has fidgets (a weight shift, a shoulder roll, a
// curious head tilt, a snort) timed to the idle loop. Stepped "on twos" posing is still available
// (poseFps > 0) if the director wants it back on other creatures.
// Rig-parameterized: rest heights and leg length are read from the bones, and stride from the
// model's world scale, so proportion changes to the model (e.g. #56) keep feet planted.

export const POSE_FPS = 0;   // 0 = smooth (every frame); e.g. 12 for stepped pixel-art posing
export const IDLE_PERIOD = 6;          // seconds; idle loops exactly over this

/** Behaviour state -> base clip (locomotion clips resolve by speed; see clipFor). */
export const STATE_CLIPS = Object.freeze({
  roam: 'locomotion', investigate: 'investigate', flee: 'flee', shadow: 'prowl',
  observe: 'stare', warn: 'stare', aggress: 'stare',
});
export const CLIPS = Object.freeze(['idle', 'walk', 'run', 'flee', 'investigate', 'prowl', 'stare', 'knock']);
// windup: anticipation before the first blow; gap: time between blows; contact: how far into each
// blow (fraction of gap) the fist meets the trunk - the strike frame the knock sound lands on.
export const KNOCK = Object.freeze({ windup: 0.38, gap: 0.62, recover: 0.45, contact: 0.1 });
/** Seconds from the start of the knock clip to blow i's contact frame (the audio syncs to this). */
export const knockStrikeTime = (i) => KNOCK.windup + i * KNOCK.gap + KNOCK.contact * KNOCK.gap;

const KNOCK_UP = 2.1;                    // shoulder angle of the reared-up club before each blow (rad)
const ease = (x) => x * x * (3 - 2 * x);
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const TAU = Math.PI * 2;

/** Which clip a state/speed pair plays (also used by the check). */
export function clipFor(state, speed) {
  const base = STATE_CLIPS[state] ?? 'locomotion';
  if (base === 'locomotion') return speed < 0.3 ? 'idle' : speed < 2.6 ? 'walk' : 'run';
  if (base === 'stare' && speed > 2.6) return 'run';      // a charge runs at you
  return base;
}

export function createBigfootAnimator(root, bones, { worldScale = 1, poseFps = POSE_FPS } = {}) {
  // ---- rig measurements (rest pose) ----
  const rest = {
    hipsY: bones.hips.position.y,
    legLen: Math.abs(bones.shinL.position.y) + Math.abs(bones.footL.position.y),
  };
  // World metres per step. #78: planted feet (bigfootBody.js) need a stride the legs can actually
  // sweep, so this is shorter than the old sliding-foot cycle (1.53) and the cadence quicker.
  const STRIDE = 0.8 * rest.legLen * worldScale;
  const L = rest.legLen;                                   // scales vertical offsets with the legs

  let phase = 0, idleT = 0, clock = 0;
  let runBlend = 0, moveBlend = 0, fleeW = 0, invW = 0, stareW = 0, prowlW = 0;
  let action = null;                                        // { name, t, count }
  let pending = 0;                                          // dt accumulated since the last pose
  let clip = 'idle';
  let lastState = 'roam', lastSpeed = 0;
  // Critically damped springs for follow-through (value, velocity per channel).
  const springs = new Map();
  const spring = (name, target, freq, dt) => {
    let sp = springs.get(name);
    if (!sp) { sp = { x: target, v: 0 }; springs.set(name, sp); }
    if (dt <= 0) return sp.x;
    // Exact critically damped step (stable for any dt).
    const w = freq, e = Math.exp(-w * dt), d = sp.x - target;
    const x = target + (d + (sp.v + w * d) * dt) * e;
    sp.v = (sp.v - w * (sp.v + w * d) * dt) * e;
    sp.x = x;
    return x;
  };

  const api = {
    STRIDE, rest, poseFps,
    get clip() { return action?.name ?? clip; },
    get phase() { return phase; },
    get action() { return action?.name ?? null; },
    play(name, opts = {}) { action = { name, t: 0, count: opts.count ?? 2 }; },
    /** Advance and pose. Poses are evaluated at poseFps (0 = every frame). */
    animate(dt, speed = 0, state = 'roam') {
      lastState = state; lastSpeed = speed;
      clip = clipFor(state, speed);
      pending += dt;
      const stepT = api.poseFps > 0 ? 1 / api.poseFps : 0;
      if (stepT && pending < stepT - 1e-6) return;          // hold the current pose
      const t = pending; pending = 0;
      evaluate(t, speed, state);
    },
  };

  function evaluate(dt, speed, state) {
    clock += dt;
    idleT = (idleT + dt) % IDLE_PERIOD;
    const k = Math.min(1, dt * 4);
    moveBlend += (clamp01(speed / 0.6) - moveBlend) * Math.min(1, dt * 6);
    runBlend += (clamp01((speed - 2.6) / 2.5) - runBlend) * k;
    const base = STATE_CLIPS[state] ?? 'locomotion';
    fleeW += ((base === 'flee' ? 1 : 0) - fleeW) * k;
    invW += ((base === 'investigate' ? 1 : 0) - invW) * k;
    stareW += ((base === 'stare' ? 1 : 0) - stareW) * k;
    prowlW += ((base === 'prowl' ? 1 : 0) - prowlW) * k;
    const low = Math.max(invW, prowlW);                    // crouched gaits
    const stride = lerp(STRIDE, STRIDE * 1.9, runBlend) * (1 - 0.25 * invW - 0.35 * prowlW);
    phase = (phase + (speed / stride) * Math.PI * dt) % TAU;
    const sw = Math.sin(phase), cw = Math.cos(phase);
    const mb = moveBlend, rb = runBlend;
    const lag = 0.45;                                       // torso/arms trail the hips (radians of phase)
    const swLag = Math.sin(phase - lag);

    // Idle clock: whole multiples of the idle period, so idle loops exactly.
    const w1 = TAU / IDLE_PERIOD;
    const breath = Math.sin(idleT * w1 * 2);                // 2 breaths per loop... slow and heavy
    const idleLook = Math.sin(idleT * w1) * 0.55 + Math.sin(idleT * w1 * 3) * 0.08;
    const idleSway = Math.sin(idleT * w1) * 0.03;
    // Idle personality beats (all locked to the idle loop): shift weight onto one leg, roll the
    // shoulders, tilt the head like he's listening, snort at the top of a breath.
    const bump = (center, width) => { let d = Math.abs(((idleT / IDLE_PERIOD - center) % 1 + 1.5) % 1 - 0.5); return Math.pow(Math.max(0, Math.cos(Math.min(Math.PI / 2, d / width * Math.PI / 2))), 2); };
    const still = 1 - mb;
    const weightShift = Math.sin(idleT * w1) * 0.07 * still;
    const shoulderRoll = bump(0.3, 0.12) * still;
    const headTilt = bump(0.62, 0.14) * still;
    const snort = bump(0.85, 0.04) * still;

    // Heavy foot plant: a sharp dip at each contact (sw = ±1 is a heel strike for one leg).
    const plant = Math.pow(Math.abs(sw), 12) * mb;
    const plantJolt = Math.pow(Math.abs(Math.sin(phase - 0.25)), 14) * mb;   // chest catches it a beat later

    // ---- body ----
    const lean = 0.32 + 0.35 * rb + 0.15 * fleeW + 0.14 * invW + 0.3 * prowlW - 0.12 * stareW;
    bones.hips.position.y = rest.hipsY
      - L * (mb * (0.04 + 0.05 * rb) + 0.07 * invW + 0.2 * prowlW)
      + L * Math.abs(cw) * mb * (0.05 + 0.08 * rb)
      - L * plant * (0.05 + 0.04 * rb)
      + (1 - mb) * breath * 0.01 * L;
    bones.hips.rotation.set(0, sw * 0.12 * mb, cw * 0.05 * mb * (1 - rb) + (1 - mb) * idleSway + weightShift);
    bones.spine.rotation.set(-lean * 0.55 - plantJolt * 0.06, -swLag * 0.1 * mb, -Math.cos(phase - lag) * 0.04 * mb);
    bones.chest.rotation.set(-(lean * 0.45 + (1 - mb) * breath * 0.035) - plantJolt * 0.05 - shoulderRoll * 0.08 + snort * 0.06,
      -swLag * 0.13 * mb + shoulderRoll * 0.12, -Math.cos(phase - lag * 1.5) * 0.05 * mb - weightShift * 0.8);

    // ---- head: stabilised against the body sway, then the clip's own look ----
    const scan = Math.sin(clock * 1.15) * 0.8 + Math.sin(clock * 2.9) * 0.15;
    const glance = Math.pow(Math.max(0, Math.sin(clock * 0.85)), 6) * 1.15;
    const yaw = lerp(lerp(lerp(idleLook * (1 - mb), scan, invW), glance, fleeW), 0, Math.max(stareW, prowlW));
    const sniff = Math.sin(clock * 6.5) * 0.05 * invW;
    const counterYaw = (bones.hips.rotation.y + bones.spine.rotation.y + bones.chest.rotation.y) * 0.7;
    // The head follows its target on a spring: it overshoots a little and settles when he
    // starts, stops or snaps his attention around (overlap / follow-through).
    const neckX = spring('neckX', lean * 0.95 - 0.12 + sniff - 0.1 * invW - 0.15 * prowlW + plantJolt * 0.04 - snort * 0.12, 9, dt);
    const neckY = spring('neckY', yaw - counterYaw, 7, dt);
    bones.neck.rotation.set(neckX, neckY, -(bones.chest.rotation.z + bones.spine.rotation.z) * 0.8 + headTilt * 0.22);
    // Jaw: breathes on the idle clock when still, pants in time with the steps when moving (keeps gaits seamless).
    if (bones.jaw) bones.jaw.rotation.x = 0.12 + (1 - mb) * breath * 0.04 + mb * Math.abs(sw) * 0.03 + rb * 0.25 + 0.2 * stareW;

    // ---- legs ----
    const legAmp = lerp(0.45, 0.85, rb) * mb * (1 - 0.25 * prowlW);
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = sw * s;
      bones[`thigh${side}`].rotation.set(a * legAmp + 0.12 + 0.12 * mb + 0.12 * invW + 0.45 * prowlW, 0, s * -0.04);
      const bendPhase = Math.max(0, Math.sin(phase + (s > 0 ? 0 : Math.PI) - Math.PI / 2 + 0.4));
      bones[`shin${side}`].rotation.set(-(0.22 + 0.15 * invW + 0.6 * prowlW + bendPhase * lerp(0.7, 1.4, rb) * mb), 0, 0);
      bones[`foot${side}`].rotation.set(-(bones[`thigh${side}`].rotation.x + bones[`shin${side}`].rotation.x), 0, 0);
    }

    // ---- arms: swing trails the legs (lag), heavy hands ----
    const armAmp = lerp(0.4, 0.9, rb) * mb * (1 + 0.25 * fleeW) * (1 - 0.5 * invW) * (1 - 0.6 * prowlW);
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = -swLag * s;
      // Heavy arms: the swing target is followed on a spring, so they drag and overshoot.
      const armX = spring(`arm${side}`, a * armAmp + lean + 0.05 + 0.25 * rb + 0.15 * invW + 0.35 * prowlW + shoulderRoll * 0.1, 11, dt);
      bones[`upperArm${side}`].rotation.set(armX, 0,
        s * -0.16 - (1 - mb) * s * 0.04 * Math.sin(idleT * w1 * 2) - 0.15 * stareW * s - (side === 'L' ? 1 : -1) * weightShift * 0.5);
      bones[`forearm${side}`].rotation.set(0.25 + 0.9 * rb + Math.max(0, a) * 0.3 * mb + 0.25 * invW + 0.3 * prowlW + plantJolt * 0.12, 0, 0);
      const curl = lerp(0.35 + rb * 0.6 + (1 - mb) * Math.sin(idleT * w1 + s) * 0.08, 0.05, Math.max(stareW, prowlW * 0.6));   // claws splay when staring / stalking
      for (let f = 0; f < 4; f++) if (bones[`finger${side}${f}`]) bones[`finger${side}${f}`].rotation.x = curl;
    }

    if (action?.name === 'knock') knock(dt);
  }

  // ---- knock: anticipation (crouch, arm draws back) -> rear up -> strike -> overshoot -> settle ----
  function knock(dt) {
    action.t += dt;
    const t = action.t, total = KNOCK.windup + (action.count - 1) * KNOCK.gap + KNOCK.recover;
    if (t >= total) { action = null; return; }
    const w = ease(Math.min(1, t / 0.12, (total - t) / 0.25));          // blend in / out
    // Position inside the current strike (0..1). The first strike's wind-up is the anticipation.
    let local, first = t < KNOCK.windup;
    if (first) local = t / KNOCK.windup; else local = ((t - KNOCK.windup) % KNOCK.gap) / KNOCK.gap;
    let arm, twist, crouch, fist = 1.1;
    const lastStrike = KNOCK.windup + (action.count - 1) * KNOCK.gap;
    if (t >= lastStrike + KNOCK.gap * 0.28) {
      // After the last blow: stay on the trunk, breathing, while the blend eases back out.
      arm = 1.3; twist = 0.16; crouch = 0.06;
    } else if (first) {
      // 0-30%: anticipation, sink and pull the arm down/back; 30-100%: rear up overhead.
      if (local < 0.3) { const u = ease(local / 0.3); arm = lerp(0.6, 0.2, u); twist = 0.18 * u; crouch = 0.12 * u; }
      else { const u = ease((local - 0.3) / 0.7); arm = lerp(0.2, KNOCK_UP, u); twist = lerp(0.18, -0.34, u); crouch = lerp(0.12, -0.04, u); }
    } else if (local < KNOCK.contact) {
      // Strike: snap down to the contact pose (the knock sound lands here) and past it ...
      const u = local / KNOCK.contact; arm = lerp(KNOCK_UP, 1.05, u); twist = lerp(-0.34, 0.24, u); crouch = lerp(-0.04, 0.1, u);
    } else if (local < 0.28) {
      // ... follow-through and settle back to the contact pose.
      const u = ease((local - KNOCK.contact) / (0.28 - KNOCK.contact)); arm = lerp(1.05, 1.3, u); twist = lerp(0.24, 0.16, u); crouch = lerp(0.1, 0.06, u);
    } else {
      // Rear up again for the next strike (or hold, then recover at the end).
      const u = ease((local - 0.28) / 0.72); arm = lerp(1.3, KNOCK_UP, u); twist = lerp(0.16, -0.34, u); crouch = lerp(0.06, -0.04, u);
    }
    const R = bones.upperArmR, F = bones.forearmR;
    R.rotation.x = lerp(R.rotation.x, arm, w);
    // Raised arm (#59): swung out from the head and only half-bent, so on the big new body it reads
    // as a clubbing forearm over the shoulder, not a limb folded back over the skull.
    const up = clamp01((arm - 1) / (KNOCK_UP - 1));
    R.rotation.z = lerp(R.rotation.z, lerp(0.25, 0.5, up), w);
    F.rotation.x = lerp(F.rotation.x, lerp(0.35, 1.05, up), w);
    for (let f = 0; f < 4; f++) if (bones[`fingerR${f}`]) bones[`fingerR${f}`].rotation.x = lerp(bones[`fingerR${f}`].rotation.x, fist, w);
    bones.chest.rotation.y = lerp(bones.chest.rotation.y, twist, w);            // twist into the blow
    bones.spine.rotation.x -= crouch * w;                                         // body sinks / follows through
    bones.hips.position.y -= crouch * 0.25 * L * w;
    bones.upperArmL.rotation.x = lerp(bones.upperArmL.rotation.x, 0.55 + twist * 0.6, w);   // off arm braces
    bones.neck.rotation.y = lerp(bones.neck.rotation.y, 0.25, w);
    if (bones.jaw) bones.jaw.rotation.x += 0.15 * w;
  }

  api.knockTiming = KNOCK;
  // Pose once at rest so the model never shows its bind pose.
  evaluate(0, 0, 'roam');
  return api;
}

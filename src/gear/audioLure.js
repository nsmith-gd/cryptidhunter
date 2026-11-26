import * as THREE from 'three';
import { groundAt } from '../maps/ground.js';

// Audio lure (Hunting Gear, L1): press L to set an electronic caller on the ground. It plays a
// recorded call every few seconds for a while; the cryptid it's made for (Bigfoot's whoop by
// default) hears it from far off and comes to investigate - other cryptids ignore it. Pair it
// with a trail camera pointed at it and you can be somewhere else entirely.
export const AUDIO_LURE = {
  carried: 1,
  placeDistance: 1.2,
  species: 'bigfoot',    // which cryptid the loaded call attracts
  callName: 'Bigfoot whoop',
  range: 90,             // metres the call carries for that cryptid
  interval: 12,          // seconds between calls
  duration: 120,         // seconds of battery
};

export class AudioLures {
  constructor({ scene, player, input, notify = () => {} }) {
    this.scene = scene;
    this.player = player;
    this.notify = notify;
    this.carried = AUDIO_LURE.carried;
    this.lures = [];
    this.ctx = null;
    this.t = 0;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !e.repeat && input.locked) this.place();
    });
  }

  place(at = null) {
    if (this.carried <= 0) return null;
    this.carried--;
    const p = this.player;
    const x = at?.x ?? p.position.x - Math.sin(p.yaw) * AUDIO_LURE.placeDistance;
    const z = at?.z ?? p.position.z - Math.cos(p.yaw) * AUDIO_LURE.placeDistance;
    const mesh = buildDevice();
    mesh.position.set(x, groundAt(x, z), z);
    mesh.rotation.y = p.yaw;
    mesh.name = 'audio-lure';
    this.scene.add(mesh);
    const lure = { x, z, mesh, species: AUDIO_LURE.species, range: AUDIO_LURE.range, age: 0, nextCall: 1.5, calls: 0, lastCallAt: -1, active: true };
    this.lures.push(lure);
    this.notify(`Audio lure set: playing a ${AUDIO_LURE.callName} every ${AUDIO_LURE.interval} s.`);
    return lure;
  }

  /**
   * Calls playing right now, for the cryptid AI: [{ x, z, species, range, id, seq }].
   * `seq` counts calls so a listener can react to each call once.
   */
  sounding() {
    return this.lures.filter((l) => l.active && l.calls > 0 && this.t - l.lastCallAt < 1)
      .map((l) => ({ x: l.x, z: l.z, species: l.species, range: l.range, id: l, seq: l.calls }));
  }

  update(dt) {
    this.t += dt;
    for (const l of this.lures) {
      if (!l.active) continue;
      l.age += dt;
      l.nextCall -= dt;
      const led = l.mesh.userData.led;
      if (l.age > AUDIO_LURE.duration) {
        l.active = false;
        led.material.color.set(0x222222);
        this.notify('The audio lure\'s battery died.');
        continue;
      }
      if (l.nextCall <= 0) {
        l.nextCall = AUDIO_LURE.interval;
        l.calls++;
        l.lastCallAt = this.t;
        this.playCall(l);
      }
      // LED: bright while calling, slow blink otherwise.
      const calling = this.t - (l.lastCallAt ?? -9) < 2.2;
      led.material.color.set(calling ? 0x44ff66 : (Math.sin(this.t * 2) > 0.7 ? 0x116622 : 0x051a08));
    }
  }

  // Placeholder synthesized "whoop": a rising then falling howl, positioned at the device.
  playCall(lure) {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 4, rolloffFactor: 1.1,
        positionX: lure.x, positionY: 0.3, positionZ: lure.z });
      const cam = this.player.camera;
      if (cam && ctx.listener.positionX) {
        const f = cam.getWorldDirection(new THREE.Vector3());
        ctx.listener.positionX.value = cam.position.x; ctx.listener.positionY.value = cam.position.y; ctx.listener.positionZ.value = cam.position.z;
        ctx.listener.forwardX.value = f.x; ctx.listener.forwardY.value = f.y; ctx.listener.forwardZ.value = f.z;
      }
      synthWhoop(ctx, panner);
      panner.connect(ctx.destination);
    } catch { /* audio unavailable (headless / blocked): the lure still works for the AI */ }
  }
}

/** The call itself (also used to render the reference clip). Connects into `out`. */
export function synthWhoop(ctx, out, t0 = ctx.currentTime) {
  const osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain(), filt = ctx.createBiquadFilter();
  osc.type = 'sawtooth'; osc2.type = 'sine';
  filt.type = 'lowpass'; filt.frequency.value = 900; filt.Q.value = 3;
  for (const o of [osc, osc2]) {
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(520, t0 + 0.6);   // rising "whoo"
    o.frequency.setValueAtTime(520, t0 + 0.9);
    o.frequency.exponentialRampToValueAtTime(260, t0 + 2.0);   // falling "oop"
  }
  osc2.detune.value = 8;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.25);
  gain.gain.setValueAtTime(0.35, t0 + 1.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);
  osc.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(out);
  osc.start(t0); osc2.start(t0); osc.stop(t0 + 2.2); osc2.stop(t0 + 2.2);
}

// Greybox device: small olive speaker box with a grille and an LED.
function buildDevice() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), new THREE.MeshStandardMaterial({ color: 0x3d4430, roughness: 0.9 }));
  box.position.y = 0.1;
  const grille = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 }));
  grille.position.set(0, 0.1, -0.091);
  grille.rotation.y = Math.PI;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: 0x44ff66 }));
  led.position.set(0.11, 0.17, -0.091);
  box.castShadow = true;
  g.add(box, grille, led);
  g.userData.led = led;
  return g;
}

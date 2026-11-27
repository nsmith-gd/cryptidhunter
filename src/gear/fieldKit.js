import * as THREE from 'three';
import { groundAt } from '../maps/ground.js';

// (The C05 headlamp is worn gear from the base-camp supplier, #88.)
// Field kit (#87): the GDD's personal gear for the early levels (01-03) that was not in the game
// yet, each with use and effect in a Pine Hollow hunt. All are loadout items (quick slot or pack,
// hotkey or Q), bought at the base-camp shop, and weigh what the catalogue says.
//
//   F03 Binoculars        O   look far without walking up (narrow view); proves nothing on its own
//   C06 Signal whistle    Y   one loud blast: carries ~60 m. Cryptids hear it (curious ones come to
//                             look, close ones are startled); also tells you where you are
//   F05 Field recorder    P   record while you listen: whoops and wood knocks in range become an
//                             acoustic recording (EV07), better closer and when you keep quiet
//   D02 Emergency bivy    Q   crawl in where you stand: warm while you stay put; moving packs it
//   B04 Dry clothes       Q   change into dry layers (a few seconds standing still): wetness gone
//   D06 Fire-starting kit Q   (6 uses) light a small fire in front of you: warmth for a few minutes,
//                             and a light anything nearby can see
export const FIELD_KIT = Object.freeze({
  binocularsFov: 16,         // degrees (~5× over the naked eye)
  whistle: { noise: 1, radius: 60, seconds: 0.6, cooldown: 2 },
  recorder: { range: 90, minQuality: 0.15 },
  bivy: { moveLimit: 0.8, heat: 1.6 },
  dryClothes: { seconds: 5 },
  fire: { uses: 6, burn: 240, radius: 4 },
});

export class FieldKit {
  constructor({ scene, camera, player, flashlight, photo = null, thermo = () => null, evidence = null, input = null, notify = () => {} }) {
    this.scene = scene; this.camera = camera; this.player = player; this.flashlight = flashlight; this.photo = photo;
    this.thermo = thermo; this.evidence = evidence; this.notify = notify;
    this.carried = { binoculars: 0, whistle: 0, fieldRecorder: 0, bivy: 0, dryClothes: 0, fireKit: 0 };
    this.binocularsOn = false;
    this.recording = false;
    this.recordings = [];
    this.whistleAt = -99;
    this.bivyAt = null;          // { x, z, mesh } while sheltering
    this.changing = null;        // { left, x, z } while changing clothes
    this.fires = [];             // { x, z, left, mesh, light }
    this.time = 0;
    this.log = [];               // { t, item, what } every use, for checks
    this.buildOverlay();
    // Hotkeys (the loadout's capture listener runs first and blocks items left at camp or in the pack).
    const KEYS = { KeyO: () => this.toggleBinoculars(), KeyY: () => this.blowWhistle(), KeyP: () => this.toggleRecorder() };
    addEventListener('keydown', (e) => { if (!e.repeat && (!input || input.locked) && KEYS[e.code]) KEYS[e.code](); });
  }

  record(item, what) { this.log.push({ t: +this.time.toFixed(2), item, what }); }

  // ---- F03 Binoculars ------------------------------------------------------------------------
  toggleBinoculars(on = !this.binocularsOn) {
    if (on && !this.carried.binoculars) return false;
    if (on === this.binocularsOn) return true;
    if (on) { this.savedFov = this.photo?.baseFov ?? this.camera.fov; this.setFov(FIELD_KIT.binocularsFov); }
    else this.setFov(this.savedFov);
    this.binocularsOn = on;
    this.overlay.style.display = on ? 'block' : 'none';
    this.record('binoculars', on ? 'raised' : 'lowered');
    return true;
  }

  setFov(fov) {
    if (this.photo) this.photo.baseFov = fov;
    this.camera.fov = fov; this.camera.updateProjectionMatrix();
  }

  // ---- C06 Signal whistle ----------------------------------------------------------------------
  blowWhistle() {
    if (!this.carried.whistle || this.time - this.whistleAt < FIELD_KIT.whistle.cooldown) return false;
    this.whistleAt = this.time;
    const w = FIELD_KIT.whistle;
    this.player.noiseBurst = { level: w.noise, radius: w.radius, left: w.seconds };
    this.playTone();
    this.notify('FWEEEET! The whistle carries a long way: anything out there heard that.');
    this.record('whistle', 'blast');
    return true;
  }

  playTone() {
    try {
      const ctx = (this.audio ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 2900;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.65);
    } catch { /* no audio (headless) */ }
  }

  // ---- F05 Field recorder ----------------------------------------------------------------------
  toggleRecorder(on = !this.recording) {
    if (on && !this.carried.fieldRecorder) return false;
    this.recording = on;
    this.notify(on ? 'Recorder running. Keep still and quiet for a clean recording.' : 'Recorder stopped.');
    this.record('fieldRecorder', on ? 'start' : 'stop');
    return true;
  }

  /**
   * A sound happened in the world: { kind: 'whoop' | 'knock', x, z, cryptid: 'bigfoot', name }.
   * While recording and in range it becomes an acoustic recording. Quality: distance and your own noise.
   */
  hear({ kind, x, z, cryptid = 'bigfoot', name = 'Bigfoot' }) {
    if (!this.recording || !this.carried.fieldRecorder) return null;
    const p = this.player.position, d = Math.hypot(x - p.x, z - p.z);
    const r = FIELD_KIT.recorder;
    if (d > r.range) return null;
    const quality = +Math.max(0, (1 - d / r.range) * (1 - (this.player.noise ?? 0) * 0.7)).toFixed(2);
    if (quality < r.minQuality) { this.notify('Too faint or too much noise on the tape to be any use.'); return null; }
    const rec = { id: `audio:${this.recordings.length + 1}`, kind, quality, distance: Math.round(d), cryptidId: cryptid, t: +this.time.toFixed(1) };
    this.recordings.push(rec);
    const item = this.evidence?.addAudio?.(rec, name);
    this.notify(`Recorded a ${kind === 'whoop' ? 'whoop' : 'wood knock'} (${d.toFixed(0)} m, quality ${Math.round(quality * 100)}%)`);
    this.record('fieldRecorder', `captured ${kind}`);
    return item ?? rec;
  }

  // ---- D02 Emergency bivy ----------------------------------------------------------------------
  toggleBivy() {
    if (!this.carried.bivy) return false;
    if (this.bivyAt) { this.packBivy('packed it away'); return true; }
    if (this.thermo()?.inWater && this.thermo().inWater !== 'dry') { this.notify('Not in the water.'); return false; }
    const p = this.player.position;
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.6, 4, 8).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe0602a, roughness: 0.6, emissive: 0x2a0c04 }));
    mesh.position.set(p.x, groundAt(p.x, p.z) + 0.3, p.z);
    mesh.rotation.y = this.player.yaw;
    mesh.name = 'emergency-bivy';
    this.scene.add(mesh);
    this.bivyAt = { x: p.x, z: p.z, mesh };
    this.notify('You crawl into the bivy. Warmer while you stay put; move and it gets packed away.');
    this.record('bivy', 'deployed');
    return true;
  }

  packBivy(why) {
    if (!this.bivyAt) return;
    this.bivyAt.mesh.removeFromParent();
    this.bivyAt = null;
    this.notify(`Bivy ${why}.`);
    this.record('bivy', 'packed');
  }

  // ---- B04 Dry clothing bundle -----------------------------------------------------------------
  changeClothes() {
    if (!this.carried.dryClothes || this.changing) return false;
    const t = this.thermo();
    if (t?.inWater && t.inWater !== 'dry') { this.notify('Get out of the water first.'); return false; }
    const p = this.player.position;
    this.changing = { left: FIELD_KIT.dryClothes.seconds, x: p.x, z: p.z };
    this.notify('Changing into dry clothes… stand still.');
    this.record('dryClothes', 'changing');
    return true;
  }

  // ---- D06 Fire-starting kit -------------------------------------------------------------------
  lightFire() {
    if (!this.carried.fireKit) return false;
    const t = this.thermo();
    if (t?.inWater && t.inWater !== 'dry') { this.notify('Not in the water.'); return false; }
    const p = this.player.position, yaw = this.player.yaw;
    const x = p.x - Math.sin(yaw) * 1.4, z = p.z - Math.cos(yaw) * 1.4, y = groundAt(x, z);
    const g = new THREE.Group();
    g.name = 'campfire-small';
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 1 }));
      log.rotation.z = Math.PI / 2; log.rotation.y = (i * Math.PI) / 4; log.position.y = 0.07;
      g.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 7), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 }));
    flame.position.y = 0.36;
    const light = new THREE.PointLight(0xff9a40, 6, 14, 1.6);
    light.position.y = 0.6;
    g.add(flame, light);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.carried.fireKit--;
    this.fires.push({ x, z, left: FIELD_KIT.fire.burn, mesh: g, flame, light });
    this.notify(`A small fire catches. Warmth for a few minutes, and light anything nearby can see. (${this.carried.fireKit} uses left)`);
    this.record('fireKit', 'lit');
    return true;
  }

  /** Warmth this kit adds, for thermoregulation's heat sources: fires, and the bivy while you're in it. */
  heatSources() {
    const out = this.fires.map((f) => ({ x: f.x, z: f.z, r: FIELD_KIT.fire.radius, name: 'your fire' }));
    if (this.bivyAt) out.push({ x: this.bivyAt.x, z: this.bivyAt.z, r: FIELD_KIT.bivy.heat, name: 'emergency bivy' });
    return out;
  }

  update(dt) {
    this.time += dt;
    const p = this.player.position;
    if (this.binocularsOn && (this.photo?.raise ?? 0) > 0.05) this.toggleBinoculars(false);      // the camera comes up instead
    if (this.bivyAt && Math.hypot(p.x - this.bivyAt.x, p.z - this.bivyAt.z) > FIELD_KIT.bivy.moveLimit) this.packBivy('packed away as you move off');
    if (this.changing) {
      if (Math.hypot(p.x - this.changing.x, p.z - this.changing.z) > 0.6) { this.changing = null; this.notify('You moved: still in the wet clothes.'); }
      else if ((this.changing.left -= dt) <= 0) {
        this.changing = null;
        const t = this.thermo(); if (t) t.wetness = 0;
        this.carried.dryClothes--;
        this.notify('Dry clothes on. Much better.');
        this.record('dryClothes', 'changed');
      }
    }
    for (const f of this.fires) {
      f.left -= dt;
      const k = Math.max(0, Math.min(1, f.left / 30));
      f.flame.scale.setScalar(0.3 + 0.7 * k * (0.9 + 0.1 * Math.sin(this.time * 17 + f.x)));
      f.light.intensity = 6 * k * (0.85 + 0.15 * Math.sin(this.time * 11 + f.z));
    }
    for (const f of this.fires.filter((q) => q.left <= 0)) { f.mesh.removeFromParent(); this.notify('Your fire has burned out.'); }
    this.fires = this.fires.filter((f) => f.left > 0);
  }

  buildOverlay() {
    // Binocular view: two overlapping circles cut out of black.
    const o = this.overlay = document.createElement('div');
    o.id = 'binocular-overlay';
    Object.assign(o.style, { position: 'fixed', inset: '0', pointerEvents: 'none', display: 'none', zIndex: '4',
      background: 'radial-gradient(circle at 38% 50%, transparent 0 27vh, transparent 27vh), radial-gradient(circle at 62% 50%, transparent 0 27vh, transparent 27vh)' });
    o.innerHTML = `<svg width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0">
      <defs><mask id="binoMask"><rect width="100%" height="100%" fill="white"/>
      <circle cx="40%" cy="50%" r="30%" fill="black"/><circle cx="60%" cy="50%" r="30%" fill="black"/></mask></defs>
      <rect width="100%" height="100%" fill="#000" mask="url(#binoMask)"/></svg>
      <div style="position:absolute;bottom:14px;width:100%;text-align:center;font:12px monospace;color:#cfd8c8;text-shadow:0 0 3px #000">BINOCULARS · O to lower · proves nothing: raise the camera to photograph</div>`;
    document.body.append(o);
  }
}

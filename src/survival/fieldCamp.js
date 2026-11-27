import * as THREE from 'three';
import { groundAt } from '../maps/ground.js';
import { pixelTexture, pixelMaterial } from '../art/pixelTex.js';
import { FATIGUE } from './fatigue.js';
import { THERMO } from './thermoregulation.js';

// S10 Shelter & campcraft + sleep (GDD 1.2 S09/S10, 3.2 D03/D06, 6.5, 12.1; task #104).
//
//   D03 Two-person tent (Q with the tent in hand): pitch it in front of you. It takes a few seconds
//       standing still, and needs a flat, dry, clear spot (not in water, not against rocks or trees).
//       Inside it you're out of the rain and wind: it shelters you (thermoregulation warms and dries
//       you) and it's where you can sleep. Q beside it (outside) packs it away again.
//   D06 Fire kit (#87): your fire is camp heat. In the rain the kindling only catches by your tent.
//   Sleep (Q inside your tent): the night fast-forwards (the whole world runs faster, the clock
//       too) while fatigue drops. Sleep quality is better with a fire close by and dry clothes.
//       You wake when you're rested, or at once when something significant happens: a creature
//       comes close, a loud cue nearby (knock, whoop, whistle), or your condition gets worse
//       (bleeding, dangerously cold, starving). Sleep never heals injuries; hunger keeps falling.
// A camp is a recovery point, not a safe zone: creatures still roam while you sleep.

export const CAMP_KIT = {
  pitchSeconds: 6,
  inside: 1.3,                 // metres from the tent centre that count as inside
  clearance: 1.6,              // no solid thing within this of the pitch spot
  fireNear: 5,                 // a fire within this of the tent warms the camp and sleep
  sleepSpeed: 8,               // world steps per step while asleep (8 × time)
  wakeAt: 5,                   // fatigue at which you wake rested
  wakeCreature: 25,            // a creature this close wakes you
  wakeCue: 60,                 // a knock / whoop / whistle within this wakes you
  wakeEnergy: 10,              // energy this low wakes you (hungry)
  quality: { tent: 0.6, fire: 0.25, dry: 0.15 },
};

function tentTexture() {
  return pixelTexture('t104-tentCanvas', 32, 32, (g, px, r, w, h) => {
    const pal = ['#1f3324', '#2c4a34', '#3a5e40', '#4c7350'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, pal[1 + ((x + y * 3) % 7 === 0 ? 1 : 0) + (r() < 0.06 ? 1 : 0)]);
    for (let y = 0; y < h; y++) { px(0, y, pal[0]); px(15, y, pal[0]); }              // seams
    for (let x = 0; x < w; x++) { px(x, h - 1, pal[0]); if (x % 4 === 0) px(x, h - 2, '#6a5a3a'); }   // muddy hem
  }, { seed: 1041 });
}

export class FieldCamp {
  constructor({ scene, player, survival, weather = null, fieldKit = null, notify = () => {}, isThreatNear = () => null, colliders = [], surfaceAt = null }) {
    Object.assign(this, { scene, player, survival, weather, fieldKit, notify, isThreatNear, colliders, surfaceAt });
    this.carried = fieldKit?.carried ?? {};   // shares the field kit's counts (loadout, pack weight)
    this.carried.tent ??= 0;
    if (fieldKit) fieldKit.camp = this;
    this.tent = null;             // { x, z, yaw, mesh }
    this.pitching = null;         // { left, x, z, yaw }
    this.sleeping = false;
    this.sleepLog = [];           // { start, end, fatigueBefore, fatigueAfter, healthBefore, healthAfter, woke }
    this.time = 0;
    this.lastCue = null;          // set by main when a loud sound happens: { x, z, what }
    this.buildOverlay();
  }

  get insideTent() {
    const p = this.player.position;
    return !!this.tent && Math.hypot(p.x - this.tent.x, p.z - this.tent.z) < CAMP_KIT.inside;
  }

  /** A fire of yours close to the tent. */
  get campFire() {
    if (!this.tent) return null;
    return (this.fieldKit?.fires ?? []).find((f) => Math.hypot(f.x - this.tent.x, f.z - this.tent.z) < CAMP_KIT.fireNear) ?? null;
  }

  /** What shelters a point from rain (for weather). */
  shelterAt(pos) {
    if (this.tent && Math.hypot(pos.x - this.tent.x, pos.z - this.tent.z) < CAMP_KIT.inside) return 'your tent';
    if (this.fieldKit?.bivyAt && Math.hypot(pos.x - this.fieldKit.bivyAt.x, pos.z - this.fieldKit.bivyAt.z) < 1) return 'the bivy';
    return null;
  }

  /** Heat/shelter for thermoregulation's heat sources. */
  heatSources() { return this.tent ? [{ x: this.tent.x, z: this.tent.z, r: CAMP_KIT.inside, name: 'your tent' }] : []; }

  /** Why a fire can't be lit here right now (rain needs cover), or null. */
  fireBlocked(pos) {
    if (!this.weather || this.weather.rain <= 0) return null;
    if (this.tent && Math.hypot(pos.x - this.tent.x, pos.z - this.tent.z) < CAMP_KIT.fireNear) return null;
    return 'The kindling is soaked: in this rain a fire will only catch in the lee of your tent';
  }

  /** The tent's one action (Q / loadout): pitch, sleep or wake, or pack it away. */
  use() {
    if (this.sleeping) { this.wake('you got up'); return true; }
    if (this.pitching) { this.notify('Still pitching the tent…'); return false; }
    if (!this.tent) return this.startPitch();
    if (this.insideTent) return this.sleep();
    const p = this.player.position;
    if (Math.hypot(p.x - this.tent.x, p.z - this.tent.z) < 3.5) { this.strike(); return true; }
    this.notify('Your tent is pitched elsewhere: go back to it to sleep or pack it');
    return false;
  }

  /** Why the spot in front of you can't take a tent, or null if it can. */
  siteProblem(x, z) {
    const s = this.surfaceAt?.(x, z, 0) ?? 'dry';
    if (s !== 'dry') return 'Not in the water: find dry ground';
    const c = CAMP_KIT.clearance;
    for (const b of this.colliders) {
      if (b.max.y < 0.3 || b.min.y > 2) continue;
      if (x > b.min.x - c && x < b.max.x + c && z > b.min.z - c && z < b.max.z + c) return 'Too cramped: find open ground away from rocks and trees';
    }
    return null;
  }

  startPitch() {
    if (!this.carried.tent) { this.notify('No tent with you'); return false; }
    const p = this.player.position, yaw = this.player.yaw;
    const x = p.x - Math.sin(yaw) * 1.8, z = p.z - Math.cos(yaw) * 1.8;
    const bad = this.siteProblem(x, z);
    if (bad) { this.notify(bad); return false; }
    this.pitching = { left: CAMP_KIT.pitchSeconds, x, z, yaw, at: { x: p.x, z: p.z } };
    this.notify('Pitching the tent… stay put');
    return true;
  }

  finishPitch() {
    const { x, z, yaw } = this.pitching;
    this.pitching = null;
    const g = new THREE.Group();
    g.name = 'pitched-tent';
    const canvas = pixelMaterial(tentTexture(), { side: THREE.DoubleSide });
    // A-frame: two sloped panels, a back wall, the door end left open.
    for (const s of [-1, 1]) {
      // Ridge along z at 1.15 m, eaves on the ground at x = ±1.
      const v = [s * 1, 0, -1.1, 0, 1.15, -1.1, 0, 1.15, 1.1, s * 1, 0, -1.1, 0, 1.15, 1.1, s * 1, 0, 1.1];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1.5, 2.2, 1.5, 0, 0, 2.2, 1.5, 2.2, 0], 2));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, canvas));
    }
    const back = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, 1.1), new THREE.Vector3(1, 0, 1.1), new THREE.Vector3(0, 1.15, 1.1)]), canvas);
    back.geometry.computeVertexNormals();
    back.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.2), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02;
    g.add(back, floor);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    g.position.set(x, groundAt(x, z), z);
    g.rotation.y = yaw;           // door faces back toward where you stood
    this.scene.add(g);
    this.tent = { x, z, yaw, mesh: g };
    this.carried.tent--;
    this.notify('Tent pitched. Step inside: out of the rain, and Q to sleep');
  }

  strike() {
    this.tent.mesh.removeFromParent();
    this.tent = null;
    this.carried.tent++;
    this.notify('Tent packed away');
  }

  sleepQuality() {
    const q = CAMP_KIT.quality, t = this.survival.thermo;
    return q.tent + (this.campFire ? q.fire : 0) + (t.wetness < 30 ? q.dry : 0);
  }

  sleep() {
    const f = this.survival.fatigue;
    if (f.value <= CAMP_KIT.wakeAt + 5) { this.notify('You\'re not tired enough to sleep'); return false; }
    const why = this.wakeReason();
    if (why) { this.notify(`Can't sleep: ${why}`); return false; }
    this.sleeping = true;
    f.asleep = true;
    f.quality = this.sleepQuality();
    const h = this.survival.health;
    this.current = { start: +this.time.toFixed(1), fatigueBefore: +f.value.toFixed(1), healthBefore: +(h?.value ?? 100).toFixed(1),
      coreBefore: +this.survival.thermo.core.toFixed(2), energyBefore: +this.survival.nutrition.energy.toFixed(1), quality: +f.quality.toFixed(2) };
    this.overlay.style.display = 'flex';
    return true;
  }

  /** Something that should wake you (or stop you falling asleep), or null. */
  wakeReason() {
    const s = this.survival, h = s.health, t = s.thermo;
    const threat = this.isThreatNear(CAMP_KIT.wakeCreature);
    if (threat) return `${threat} is close`;
    if (this.lastCue && this.time - this.lastCue.t < 2) return `${this.lastCue.what} nearby`;
    if (h?.bleeding?.length) return 'you\'re bleeding: bandage it (B)';
    if (h && h.value <= 15) return 'you\'re badly hurt';
    if (t.lethal && t.core < THERMO.hypothermiaSoon) return 'you\'re dangerously cold';
    if (s.nutrition.energy <= CAMP_KIT.wakeEnergy) return 'you\'re starving';
    if (!this.insideTent) return 'you\'re not in the tent';
    return null;
  }

  wake(why) {
    if (!this.sleeping) return;
    this.sleeping = false;
    const s = this.survival, f = s.fatigue;
    f.asleep = false;
    const entry = { ...this.current, end: +this.time.toFixed(1), fatigueAfter: +f.value.toFixed(1), healthAfter: +(s.health?.value ?? 100).toFixed(1),
      coreAfter: +s.thermo.core.toFixed(2), energyAfter: +s.nutrition.energy.toFixed(1), woke: why };
    this.sleepLog.push(entry);
    this.overlay.style.display = 'none';
    const mins = Math.round((entry.end - entry.start) / 60);
    this.notify(`You wake: ${why}. Slept ${mins < 1 ? 'under a minute' : `${mins} min`}; fatigue ${Math.round(entry.fatigueBefore)} → ${Math.round(entry.fatigueAfter)}`);
  }

  /** Report a loud sound: { x, z, what }. Wakes you if it's close enough. */
  cue({ x, z, what }) {
    const p = this.player.position;
    if (Math.hypot(x - p.x, z - p.z) < CAMP_KIT.wakeCue) this.lastCue = { x, z, what, t: this.time };
  }

  /** How many world steps to run per sim step: sleep fast-forwards time. */
  get timeScale() { return this.sleeping ? CAMP_KIT.sleepSpeed : 1; }

  update(dt) {
    this.time += dt;
    if (this.pitching) {
      const p = this.player.position;
      if (Math.hypot(p.x - this.pitching.at.x, p.z - this.pitching.at.z) > 0.6) { this.pitching = null; this.notify('You moved: the tent isn\'t up'); }
      else if ((this.pitching.left -= dt) <= 0) this.finishPitch();
    }
    if (this.sleeping) {
      const f = this.survival.fatigue;
      f.quality = this.sleepQuality();
      const why = this.wakeReason();
      if (why) this.wake(`woken: ${why}`);
      else if (f.value <= CAMP_KIT.wakeAt) this.wake('rested');
      else this.renderOverlay();
    }
  }

  buildOverlay() {
    const o = this.overlay = document.createElement('div');
    o.id = 'sleep-overlay';
    Object.assign(o.style, { position: 'fixed', inset: '0', background: 'rgba(2,4,8,0.88)', display: 'none', zIndex: '13', pointerEvents: 'none',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', font: '14px monospace', color: '#c8d0d8', textAlign: 'center', whiteSpace: 'pre' });
    document.body.append(o);
  }

  renderOverlay() {
    const s = this.survival, f = s.fatigue;
    const text = `ASLEEP  ·  time passing ×${CAMP_KIT.sleepSpeed}\n\nFatigue ${Math.round(f.value)}   Body ${s.thermo.core.toFixed(1)}°C   Energy ${Math.round(s.nutrition.energy)}\n` +
      `Sleep quality ${Math.round(f.quality * 100)}%${this.campFire ? ' (fire)' : ''}${s.thermo.wetness >= 30 ? ' (wet clothes)' : ''}\n\nQ to get up`;
    if (this.overlay.textContent !== text) this.overlay.textContent = text;
  }
}

export { FATIGUE };

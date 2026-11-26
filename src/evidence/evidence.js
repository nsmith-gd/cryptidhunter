import * as THREE from 'three';
import { lightAt, clueQuality, photoRecord } from './photoEvidence.js';

// Collectable physical evidence (GDD 4.2 EV01/EV02/EV04/EV05, 4.3). Clues used to be examine-only;
// now you can take something home and sell it.
//   EV01 Footprint photo        photograph a footprint with the camera
//   EV04 Disturbance photo      photograph scratch marks
//   EV02 Physical trace         aim at a hair tuft, X: bag it in a sample pouch (5 per hunt)
//   EV05 Footprint cast         aim at a footprint, X: pour a cast (casting kit, 3 per hunt; takes a few s)
//   EV06 Biological sample      aim at droppings, X: take a sample in a vial (3 per hunt)
//   EV04 also covers a snapped branch (photograph it). Deer tracks are ordinary-animal false leads: no value.
// Lifecycle per item: observed (you've seen the clue) -> collected (in your pack) -> extracted
// (you drove home) -> sold at base camp; or lost if the hunt ends any other way (GDD 4.3, 4.10).
// One item per clue per evidence type: the same footprint can't be photographed twice for money.

export const EVIDENCE = {
  reach: 3.5,                                   // metres to bag or cast
  photoReach: 7,                                // metres for a usable clue photo
  aimCone: THREE.MathUtils.degToRad(10),
  castTime: 4,                                  // seconds for a cast to set
  pouches: 5, castingKits: 3, sampleVials: 3,   // F02 pouches, F06 casting kit, F04 vial kit
  types: {
    footprintPhoto: { id: 'EV01', name: 'Footprint photo', base: 10, from: 'footprint', how: 'photo' },
    disturbancePhoto: { id: 'EV04', name: 'Disturbance photo', base: 8, from: 'scratch', how: 'photo' },
    hairSample: { id: 'EV02', name: 'Hair sample', base: 15, from: 'hair', how: 'pouch' },
    biologicalSample: { id: 'EV06', name: 'Droppings sample', base: 30, from: 'scat', how: 'vial' },
    footprintCast: { id: 'EV05', name: 'Footprint cast', base: 20, from: 'footprint', how: 'cast' },
  },
  dollarsPerUnit: 3,                            // $ per base unit (photos pay ~$2 per score point)
  novelty: [1, 0.5, 0.25],                      // repeats of the same type & cryptid pay less (GDD 4.7), floor 0.25
};

const CRYPTID_NAMES = { bigfoot: 'Bigfoot', mothman: 'Mothman', chupacabra: 'Chupacabra' };

export class EvidenceKit {
  constructor({ camera, clues, input, notify = () => {} }) {
    this.camera = camera;
    this.clues = clues;               // ClueSystem
    this.notify = notify;
    this.pouches = EVIDENCE.pouches;
    this.castingKits = EVIDENCE.castingKits;
    this.sampleVials = EVIDENCE.sampleVials;
    this.items = [];                  // { id, type, name, clueId, cryptid, stage, at }
    this.observed = new Set();        // clue ids you've had in view up close
    this.casting = null;              // { clue, left }
    this.time = 0;
    this.nextId = 1;
    this._fwd = new THREE.Vector3(); this._to = new THREE.Vector3();
    this.buildPrompt();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyX' && !e.repeat && input.locked) this.collect();
    });
  }

  has(clueId, type) { return this.items.some((i) => i.clueId === clueId && i.type === type); }

  /** The clue under the crosshair within `reach`, or null. */
  aimed(reach = EVIDENCE.reach) {
    this.camera.updateMatrixWorld();
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    this.camera.getWorldDirection(this._fwd);
    let best = null, bestA = EVIDENCE.aimCone;
    for (const c of this.clues.clues) {
      this._to.set(c.x - eye.x, c.y + 0.03 - eye.y, c.z - eye.z);
      const d = this._to.length();
      if (d > reach || d < 0.05) continue;
      const a = this._fwd.angleTo(this._to);
      if (a < bestA) { bestA = a; best = c; }
    }
    return best;
  }

  add(type, clue) {
    const t = EVIDENCE.types[type];
    const item = { id: this.nextId++, type, evId: t.id, name: t.name, clueId: clue.id, cryptid: CRYPTID_NAMES[clue.cryptidId] ?? clue.cryptidId,
      stage: 'collected', at: +this.time.toFixed(2) };
    this.items.push(item);
    this.observed.add(clue.id);
    return item;
  }

  /** X: bag a hair tuft, or start casting a footprint. */
  collect() {
    if (this.casting) { this.notify('Wait for the cast to set'); return null; }
    const c = this.aimed();
    if (!c) { this.notify('Nothing to collect here: aim at a hair tuft or a footprint'); return null; }
    if (c.type === 'hair') {
      if (this.has(c.id, 'hairSample')) { this.notify('Already bagged'); return null; }
      if (this.pouches <= 0) { this.notify('No sample pouches left'); return null; }
      this.pouches--;
      const item = this.add('hairSample', c);
      c.object.visible = false;                        // you took it
      this.notify(`Hair sample bagged (${this.pouches} pouches left)`);
      return item;
    }
    if (c.type === 'scat') {
      if (this.has(c.id, 'biologicalSample')) { this.notify('Already sampled'); return null; }
      if (this.sampleVials <= 0) { this.notify('No sample vials left'); return null; }
      this.sampleVials--;
      const item = this.add('biologicalSample', c);
      this.notify(`Droppings sample in a vial (${this.sampleVials} vials left)`);
      return item;
    }
    if (c.type === 'deerTrack') { this.notify('Just a deer: no buyer wants that'); return null; }
    if (c.type === 'footprint') {
      if (this.has(c.id, 'footprintCast')) { this.notify('Already cast'); return null; }
      if (this.castingKits <= 0) { this.notify('No casting kits left: photograph it instead'); return null; }
      this.castingKits--;
      this.casting = { clue: c, left: EVIDENCE.castTime };
      this.notify('Pouring a cast… stay close while it sets');
      return null;
    }
    this.notify('Scratch marks can\'t be collected: photograph them');
    return null;
  }

  /**
   * Called after every camera shot (entry: the camera log entry, photo: the PhotoCamera). A clue
   * near the middle of the frame becomes a photo record, if it is really in the frame and visible
   * (#85): the shot gets a quality snapshot (light, blur, framing, distance and angle) and an
   * evidence record on the roll. Ordinary-animal signs (deer tracks) stay on the roll as a photo,
   * but are no cryptid evidence: HQ would reject them (GDD 4.5).
   */
  photographed(entry = null, photo = null) {
    const c = this.aimed(EVIDENCE.photoReach);
    if (!c) return null;
    const kind = c.type === 'footprint' || c.type === 'deerTrack' ? 'footprint' : (c.type === 'scratch' || c.type === 'branch') ? 'disturbance' : null;
    if (!kind) return null;
    let quality = null, rec = null;
    if (photo && entry) {
      const view = clueView(photo, c);
      if (view.inFrame === 0 || view.unobstructed === 0) { this.notify('The clue wasn\'t really in the shot'); return null; }
      const ctx = photo.evidenceContext?.() ?? {};
      const light = lightAt(photo.scene, new THREE.Vector3(c.x, c.y + 0.03, c.z), { ambient: ctx.ambient ?? 0.05, nightVision: !!ctx.nightVision });
      quality = clueQuality({ view, light, steadiness: entry.steadiness ?? 1, committed: ctx.committed !== false });
      rec = photoRecord({ id: `${ctx.attemptId ?? 'A?'}-F${entry.frame}-clue${c.id}`, kind,
        source: { kind: 'clue', id: c.id, actual: c.type === 'deerTrack' ? 'deer (ordinary animal)' : (CRYPTID_NAMES[c.cryptidId] ?? c.cryptidId) },
        eventId: `clue:${c.id}`, attemptId: ctx.attemptId ?? null, time: ctx.time ?? this.time,
        location: photo.camera.getWorldPosition(new THREE.Vector3()), frame: entry.frame, quality, thumb: entry.thumb });
      photo.records.push(rec);
      entry.clueEvidence = rec;
    }
    if (c.type === 'deerTrack') return null;   // a clear photo of an ordinary animal's sign is no evidence (GDD 4.5)
    const type = kind === 'footprint' ? 'footprintPhoto' : 'disturbancePhoto';
    if (this.has(c.id, type)) return null;
    const item = this.add(type, c);
    if (quality) { item.quality = quality; item.recordId = rec.id; }
    this.notify(`${item.name} saved as evidence${quality?.problems.length ? `, but: ${quality.problems[0]}` : ''}`);
    return item;
  }

  update(dt) {
    this.time += dt;
    const near = this.aimed(EVIDENCE.photoReach);
    if (near) this.observed.add(near.id);
    if (this.casting) {
      const c = this.casting.clue, eye = this.camera.position;
      if (Math.hypot(c.x - eye.x, c.z - eye.z) > EVIDENCE.reach + 1.5) { this.casting = null; this.notify('You walked away: the cast was ruined'); return; }
      if ((this.casting.left -= dt) <= 0) {
        this.casting = null;
        this.add('footprintCast', c);
        this.notify(`Footprint cast lifted (${this.castingKits} kits left)`);
      }
    }
  }

  /** End of hunt: drove home → extracted (sold at camp); anything else → lost. */
  settle(extracted) {
    for (const i of this.items) i.stage = extracted ? 'extracted' : 'lost';
    return this.items;
  }

  get carried() { return this.items.filter((i) => i.stage === 'collected'); }

  // --- prompt under the crosshair ----------------------------------------------------------
  buildPrompt() {
    this.prompt = Object.assign(document.createElement('div'), { id: 'evidence-prompt' });
    Object.assign(this.prompt.style, { position: 'fixed', left: '50%', top: 'calc(50% + 40px)', transform: 'translateX(-50%)',
      color: '#cfe8c8', font: '12px monospace', textShadow: '0 0 3px #000', pointerEvents: 'none', whiteSpace: 'nowrap' });
    document.body.append(this.prompt);
  }

  render() {
    let text = '';
    if (this.casting) text = `Cast setting… ${Math.ceil(this.casting.left)} s`;
    else {
      const c = this.aimed();
      if (c?.type === 'hair' && !this.has(c.id, 'hairSample')) text = `[X] Bag hair sample (${this.pouches} pouches)`;
      else if (c?.type === 'footprint') {
        const parts = [];
        if (!this.has(c.id, 'footprintCast')) parts.push(`[X] Cast it (${this.castingKits} kits)`);
        if (!this.has(c.id, 'footprintPhoto')) parts.push('photograph it for evidence');
        text = parts.join(' · ');
      } else if ((c?.type === 'scratch' || c?.type === 'branch') && !this.has(c.id, 'disturbancePhoto')) text = `Photograph the ${c.type === 'branch' ? 'snapped branch' : 'scratch marks'} for evidence`;
      else if (c?.type === 'scat' && !this.has(c.id, 'biologicalSample')) text = `[X] Take a sample (${this.sampleVials} vials)`;
      else if (c?.type === 'deerTrack') text = 'Deer tracks: just a deer';
    }
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
  }
}

/**
 * How a clue sits in the camera's frame: share of its points in frame, share of those not blocked,
 * distance from the lens and how steeply you look down on it (radians below horizontal).
 */
export function clueView(photo, c) {
  const cam = photo.toolCamera ?? photo.camera;
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const eye = cam.getWorldPosition(new THREE.Vector3());
  const y = c.y + 0.03, r = 0.18;
  const pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dz]) => new THREE.Vector3(c.x + dx, y, c.z + dz));
  const inFrame = pts.filter((p) => frustum.containsPoint(p));
  const clear = inFrame.filter((p) => photo.clearLine(eye, p, c.object));
  const centre = pts[0], distance = eye.distanceTo(centre);
  return { inFrame: inFrame.length / pts.length, unobstructed: inFrame.length ? clear.length / inFrame.length : 0, distance,
    downAngle: Math.asin(Math.max(-1, Math.min(1, (eye.y - centre.y) / Math.max(0.01, distance)))) };
}

/** Sale value of extracted evidence: base units × $ × novelty per type and cryptid (GDD 4.7). */
export function valueEvidence(items) {
  const seen = new Map();
  return items.map((i) => {
    const key = `${i.type}:${i.cryptid}`;
    const n = seen.get(key) ?? 0; seen.set(key, n + 1);
    const novelty = EVIDENCE.novelty[Math.min(n, EVIDENCE.novelty.length - 1)];
    return { ...i, novelty, value: Math.round(EVIDENCE.types[i.type].base * EVIDENCE.dollarsPerUnit * novelty) };
  });
}

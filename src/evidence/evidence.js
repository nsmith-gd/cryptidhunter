import * as THREE from 'three';

// Collectable physical evidence (GDD 4.2 EV01/EV02/EV04/EV05, 4.3). Clues used to be examine-only;
// now you can take something home and sell it.
//   EV01 Footprint photo        photograph a footprint with the camera
//   EV04 Disturbance photo      photograph scratch marks
//   EV02 Physical trace         aim at a hair tuft, X: bag it in a sample pouch (5 per hunt)
//   EV05 Footprint cast         aim at a footprint, X: pour a cast (casting kit, 3 per hunt; takes a few s)
// Lifecycle per item: observed (you've seen the clue) -> collected (in your pack) -> extracted
// (you drove home) -> sold at base camp; or lost if the hunt ends any other way (GDD 4.3, 4.10).
// One item per clue per evidence type: the same footprint can't be photographed twice for money.

export const EVIDENCE = {
  reach: 3.5,                                   // metres to bag or cast
  photoReach: 7,                                // metres for a usable clue photo
  aimCone: THREE.MathUtils.degToRad(10),
  castTime: 4,                                  // seconds for a cast to set
  pouches: 5, castingKits: 3,
  types: {
    footprintPhoto: { id: 'EV01', name: 'Footprint photo', base: 10, from: 'footprint', how: 'photo' },
    disturbancePhoto: { id: 'EV04', name: 'Disturbance photo', base: 8, from: 'scratch', how: 'photo' },
    hairSample: { id: 'EV02', name: 'Hair sample', base: 15, from: 'hair', how: 'pouch' },
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

  /** Called after every camera shot: a clue in the middle of the frame becomes a photo record. */
  photographed() {
    const c = this.aimed(EVIDENCE.photoReach);
    if (!c) return null;
    const type = c.type === 'footprint' ? 'footprintPhoto' : c.type === 'scratch' ? 'disturbancePhoto' : null;
    if (!type || this.has(c.id, type)) return null;
    const item = this.add(type, c);
    this.notify(`${item.name} saved as evidence`);
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
      } else if (c?.type === 'scratch' && !this.has(c.id, 'disturbancePhoto')) text = 'Photograph the scratch marks for evidence';
    }
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
  }
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

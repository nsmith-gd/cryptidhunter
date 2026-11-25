import { CLUE_TYPES, BUILDERS } from './clueTypes.js';

const MAX_FOOTPRINTS = 400; // oldest prints are culled first past this

// Owns every clue in the level: spawning, ageing/fading, removal.
// Each clue: { id, type, cryptidId, x, y, z, origin:{x,z}, age, lifetime, found, object }
export class ClueSystem {
  constructor(scene) {
    this.scene = scene;
    this.clues = [];
    this.nextId = 1;
    this.listeners = new Set();
  }

  /** Subscribe to 'spawn' / 'expire' events: fn(event, clue). Returns an unsubscribe fn. */
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev, clue) { for (const fn of this.listeners) fn(ev, clue); }

  /**
   * @param {string} type key of CLUE_TYPES
   * @param {object} o { cryptidId, position:{x,y,z}, rotationY, origin:{x,z}, data, normal? }
   */
  spawn(type, { cryptidId, position, rotationY = 0, origin, data = {} }) {
    const def = CLUE_TYPES[type];
    const object = BUILDERS[type](data);
    object.position.set(position.x, position.y ?? 0, position.z);
    object.rotation.y = rotationY;
    object.name = `clue-${type}`;
    this.scene.add(object);
    const clue = {
      id: this.nextId++, type, cryptidId,
      x: position.x, y: position.y ?? 0, z: position.z,
      origin: origin ?? { x: position.x, z: position.z },
      age: 0, lifetime: def.lifetime, found: false, object,
    };
    object.userData.clue = clue;
    this.clues.push(clue);
    this.emit('spawn', clue);

    if (type === 'footprint') {
      let prints = 0;
      for (const c of this.clues) if (c.type === 'footprint') prints++;
      if (prints > MAX_FOOTPRINTS) this.remove(this.clues.find((c) => c.type === 'footprint'));
    }
    return clue;
  }

  /** 0..1 visibility from age: full until the fade window, then linear to 0. */
  static opacity(clue) {
    const fadeStart = clue.lifetime * (1 - CLUE_TYPES[clue.type].fadeFraction);
    if (clue.age <= fadeStart) return 1;
    return Math.max(0, 1 - (clue.age - fadeStart) / (clue.lifetime - fadeStart));
  }

  update(dt) {
    for (let i = this.clues.length - 1; i >= 0; i--) {
      const c = this.clues[i];
      c.age += dt;
      if (c.age >= c.lifetime) { this.remove(c); continue; }
      const o = ClueSystem.opacity(c);
      c.object.traverse((m) => { if (m.material) m.material.opacity = o; });
    }
  }

  remove(clue) {
    const i = this.clues.indexOf(clue);
    if (i < 0) return;
    this.clues.splice(i, 1);
    clue.object.removeFromParent();
    const seen = new Set();
    clue.object.traverse((m) => { if (m.material && !seen.has(m.material)) { seen.add(m.material); m.material.dispose(); } });
    this.emit('expire', clue);
  }

  clear() { while (this.clues.length) this.remove(this.clues[0]); }
}

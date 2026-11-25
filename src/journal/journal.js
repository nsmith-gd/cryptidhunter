import { CLUE_TYPES } from '../clues/clueTypes.js';
import { assess, describeClue, CLUES_FOR_VERDICT } from './clueEvidence.js';

// The field journal's data: clues the player has examined, with type and age, and the
// resulting verdict on which cryptid made them. Entries outlive the clue fading in the world.
export class Journal {
  constructor() {
    this.entries = []; // newest last
    this.time = 0;     // game seconds
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  update(dt) { this.time += dt; }

  has(clue) { return this.entries.some((e) => e.clueId === clue.id); }

  /** Record an examined clue. Returns the new entry, or null if it was already logged. */
  record(clue) {
    if (this.has(clue)) return null;
    clue.found = true;
    const entry = {
      clueId: clue.id,
      type: clue.type,
      label: CLUE_TYPES[clue.type]?.label ?? clue.type,
      description: describeClue(clue),
      clue: { type: clue.type, y: clue.y, data: clue.data }, // snapshot for the evidence model
      ageWhenFound: clue.age,
      foundAt: this.time,
      position: { x: clue.x, z: clue.z },
    };
    this.entries.push(entry);
    for (const fn of this.listeners) fn('record', entry);
    return entry;
  }

  /** How old the clue is now (seconds since the cryptid left it). */
  ageOf(entry) { return entry.ageWhenFound + (this.time - entry.foundAt); }

  /** { ready, needed, ranking:[{id,name,confidence}], likely } */
  verdict() {
    const ranking = assess(this.entries.map((e) => e.clue));
    const ready = this.entries.length >= CLUES_FOR_VERDICT;
    return { ready, needed: Math.max(0, CLUES_FOR_VERDICT - this.entries.length), ranking, likely: ready ? ranking[0] : null };
  }
}

export function formatAge(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s old`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s old`;
  return `${Math.floor(m / 60)}h ${m % 60}m old`;
}

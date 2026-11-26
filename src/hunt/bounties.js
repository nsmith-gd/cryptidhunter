// Bounty board (#45): standing offers at base camp for specific evidence. Each bounty names a
// target cryptid, a minimum photo score and a bonus. When photos are sold, every sold photo is
// checked against the active bounties; a match at or above the threshold pays the bonus once and
// the bounty is marked complete (completion is kept in the save file).
//
// Pure game logic: no DOM. Photos come in through a minimal record so this works with whatever
// produces them (the camera's score today; #50's scoring and #51's film roll/album later):
//   { cryptid: 'bigfoot', score: 72 }   or the camera's   { subject: 'Bigfoot', score: 72 }

/** Starter bounties (placeholder set; see GDD v1.1 section 7, docs/Cryptozoology_GDD_v1.1.md): offered in order, ACTIVE_COUNT at a time. */
export const STARTER_BOUNTIES = Object.freeze([
  { id: 'bigfoot-clear', cryptid: 'bigfoot', minScore: 40, bonus: 150, title: 'Any clear shot of Bigfoot' },
  { id: 'bigfoot-70', cryptid: 'bigfoot', minScore: 70, bonus: 500, title: 'A good Bigfoot photo' },
  { id: 'mothman-60', cryptid: 'mothman', minScore: 60, bonus: 400, title: 'Mothman on film' },
  { id: 'chupacabra-60', cryptid: 'chupacabra', minScore: 60, bonus: 450, title: 'Proof of the Chupacabra' },
  { id: 'bigfoot-90', cryptid: 'bigfoot', minScore: 90, bonus: 1200, title: 'Bigfoot cover shot' },
]);

export const ACTIVE_COUNT = 3;

const CRYPTID_NAMES = { bigfoot: 'Bigfoot', mothman: 'Mothman', chupacabra: 'Chupacabra' };

/** Normalise a photo's subject to a cryptid id ('Bigfoot', 'The Mothman' -> 'bigfoot', 'mothman'). */
export function cryptidIdOf(photo) {
  const raw = photo?.cryptid ?? photo?.cryptidId ?? photo?.subject ?? '';
  return String(raw).toLowerCase().replace(/^the\s+/, '').trim();
}

export function cryptidName(id) { return CRYPTID_NAMES[id] ?? id; }

export class BountyBoard {
  /**
   * @param {object} o { completed: string[] (ids already paid), bounties: table (default starter set) }
   */
  constructor({ completed = [], bounties = STARTER_BOUNTIES } = {}) {
    this.bounties = bounties;
    this.completed = new Set(completed);
  }

  isComplete(id) { return this.completed.has(id); }

  /** The bounties on the board right now: the first ACTIVE_COUNT not yet completed. */
  active() { return this.bounties.filter((b) => !this.completed.has(b.id)).slice(0, ACTIVE_COUNT); }

  /** Everything for the board UI: active offers plus the ones you've already claimed. */
  listing() {
    return { active: this.active(), completed: this.bounties.filter((b) => this.completed.has(b.id)) };
  }

  /**
   * Check sold photos against the active bounties. Each bounty pays at most once (ever), and each
   * photo can claim at most one bounty (the biggest it qualifies for).
   * Returns { bonus, paid: [{ id, title, cryptid, minScore, bonus, score }] }.
   */
  applySale(photos = []) {
    const open = this.active();
    const paid = [];
    // Best photos first, so a great shot claims the bigger bounty.
    const sorted = [...photos].filter((p) => Number.isFinite(p?.score)).sort((a, b) => b.score - a.score);
    for (const photo of sorted) {
      const id = cryptidIdOf(photo);
      const match = open
        .filter((b) => !this.completed.has(b.id) && b.cryptid === id && photo.score >= b.minScore)
        .sort((a, b) => b.bonus - a.bonus)[0];
      if (!match) continue;
      this.completed.add(match.id);
      paid.push({ ...match, score: photo.score });
    }
    return { bonus: paid.reduce((s, b) => s + b.bonus, 0), paid };
  }

  get completedIds() { return [...this.completed]; }
}

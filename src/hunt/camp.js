// Base camp (L1): what carries over between hunts — money, owned gear and a log of past hunts.
// Photos are "unsaved evidence" until you make it back to the van: get caught (or let dawn
// catch you) and this hunt's photos are lost and earn nothing, but you keep your gear.
// Stored in localStorage (one key); falls back to memory if storage is unavailable.
// (When the save-file task lands, this state should move into it.)

export const CAMP = {
  storageKey: 'cryptidhunter.camp.v1',
  ratePerPoint: 2,          // $ per photo-score point
  targetBonus: 3,           // the hunt's target cryptid is worth this many times more
  // Starter kit: consumables are topped back up to this at camp before every hunt.
  starter: { camera: 1, flashlight: 1, bait: 3, spareBatteries: 1 },
};

const GEAR_NAMES = { camera: 'camera', flashlight: 'flashlight', bait: 'bait', spareBatteries: 'spare battery' };

let memory = null;

export class Camp {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.state = this.load();
  }

  static fresh() {
    return { money: 0, gear: { ...CAMP.starter }, hunts: [] };
  }

  load() {
    try {
      const raw = this.storage?.getItem(CAMP.storageKey) ?? memory;
      if (raw) {
        const s = JSON.parse(raw);
        return { ...Camp.fresh(), ...s, gear: { ...CAMP.starter, ...s.gear } };
      }
    } catch { /* corrupt or blocked: start fresh */ }
    return Camp.fresh();
  }

  save() {
    const raw = JSON.stringify(this.state);
    memory = raw;
    try { this.storage?.setItem(CAMP.storageKey, raw); } catch { /* private mode etc. */ }
  }

  reset() { this.state = Camp.fresh(); this.save(); }

  get lastHunt() { return this.state.hunts[this.state.hunts.length - 1] ?? null; }

  /** Packing for a hunt: camp tops consumables up to the starter kit, returns what you carry. */
  packForHunt() {
    const g = this.state.gear;
    for (const [k, n] of Object.entries(CAMP.starter)) g[k] = Math.max(g[k] ?? 0, n);
    this.save();
    return { ...g };
  }

  /** Value of a set of photos: best score per subject, the target worth more. */
  static valuePhotos(photos, target) {
    const best = new Map();
    for (const p of photos) if (p.subject) best.set(p.subject, Math.max(best.get(p.subject) ?? 0, p.score ?? 0));
    let total = 0;
    const sold = [];
    for (const [subject, score] of best) {
      const value = Math.round(score * CAMP.ratePerPoint * (subject === target ? CAMP.targetBonus : 1));
      sold.push({ subject, score, value });
      total += value;
    }
    return { total, sold };
  }

  /**
   * Settle a finished hunt. outcome: complete | abandoned | dawn | caught.
   * photos: every HIT taken this hunt ({ subject, score }). gearLeft: what you still carry.
   * Only a hunt you drove home from (complete / abandoned) keeps its photos.
   */
  settleHunt({ outcome, photos, gearLeft, target }) {
    const keptPhotos = outcome === 'complete' || outcome === 'abandoned';
    const { total, sold } = keptPhotos ? Camp.valuePhotos(photos, target) : { total: 0, sold: [] };
    // Gear always comes home: what you carried at the end of the hunt is what camp owns.
    for (const [k, n] of Object.entries(gearLeft ?? {})) this.state.gear[k] = n;
    this.state.money += total;
    const entry = {
      n: this.state.hunts.length + 1, outcome, target,
      photosTaken: photos.length, photosLost: keptPhotos ? 0 : photos.length,
      sold, earned: total, moneyAfter: this.state.money, gear: { ...this.state.gear },
    };
    this.state.hunts.push(entry);
    if (this.state.hunts.length > 50) this.state.hunts.shift();
    this.save();
    return entry;
  }
}

export function gearList(gear) {
  return Object.entries(gear).filter(([, n]) => n > 0)
    .map(([k, n]) => (k === 'camera' || k === 'flashlight' ? GEAR_NAMES[k] : `${n} ${GEAR_NAMES[k] ?? k}${n > 1 && k === 'spareBatteries' ? 's' : ''}`)).join(', ');
}

/** One-paragraph summary of a settled hunt for end screens and the camp panel. */
export function huntSummary(h) {
  if (!h) return '';
  const lost = h.photosLost ? `${h.photosLost} photo${h.photosLost > 1 ? 's' : ''} lost` : '';
  const why = { caught: 'Caught', dawn: 'Dawn broke', complete: 'Made it out', abandoned: 'Headed home' }[h.outcome] ?? h.outcome;
  const money = h.earned > 0 ? `+$${h.earned}` : 'no new earnings ($0)';
  return [`${why}${lost ? ` — ${lost}` : ''}: ${money}.`, ...h.sold.map((s) => `  ${s.subject} photo, score ${s.score}: $${s.value}`)].join('\n');
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

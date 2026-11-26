// Base camp (L1): what carries over between hunts — money, owned gear and a log of past hunts.
// Photos are "unsaved evidence" until you make it back to the van: get caught (or let dawn
// catch you) and this hunt's photos are lost and earn nothing, but you keep your gear.
// Stored in localStorage (one key); falls back to memory if storage is unavailable.
// Money lives in the save file (save/saveService.js): loaded on start, saved whenever it changes.

export const CAMP = {
  storageKey: 'cryptidhunter.camp.v1',
  ratePerPoint: 2,          // $ per photo-score point
  greatPhoto: 70,           // a target photo scoring this much earns double reputation
  targetBonus: 3,           // the hunt's target cryptid is worth this many times more
  // Starter kit: consumables are topped back up to this at camp before every hunt.
  starter: { camera: 1, flashlight: 1, bait: 3, spareBatteries: 1, trailCamera: 2, audioLure: 1, nightVision: 1, knockStick: 1 },
};

const GEAR_NAMES = { camera: 'camera', flashlight: 'flashlight', bait: 'bait', spareBatteries: 'spare battery',
  trailCamera: 'trail camera', audioLure: 'audio lure', nightVision: 'night-vision goggles', knockStick: 'knock stick' };

import { SaveService } from '../save/saveService.js';
import { BountyBoard } from './bounties.js';

let memory = null;

export class Camp {
  constructor(storage = safeStorage(), saveService = new SaveService()) {
    this.storage = storage;
    this.saveService = saveService;
    this.state = this.load();
    // The save file is the source of truth for money and for which bounties are already paid.
    const saved = this.saveService.load();
    this.state.money = saved.money;
    this.bounties = new BountyBoard({ completed: saved.bountiesDone ?? [] });
  }

  static fresh() {
    return { money: 0, gear: { ...CAMP.starter }, hunts: [], reputation: 0, map: null };
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
    // Keep the rest of the save (e.g. settings, #76) and update what camp owns.
    this.saveService.save({ ...this.saveService.load(), money: this.state.money, bountiesDone: this.bounties?.completedIds ?? [] });
    const raw = JSON.stringify(this.state);
    memory = raw;
    try { this.storage?.setItem(CAMP.storageKey, raw); } catch { /* private mode etc. */ }
  }

  reset() { this.state = Camp.fresh(); this.bounties = new BountyBoard(); this.save(); }

  /**
   * Sell evidence (#45): normal score-based value (best photo per cryptid), an optional extra
   * rate (home before dawn), then each sold photo is checked against the active bounties and any
   * it meets pay their bonus once. Adds the money and saves.
   * photos: [{ subject|cryptid, score }] (the camera's records today; #51's album later).
   */
  sellPhotos(photos, target, { extraRate = 0 } = {}) {
    const { total: base, sold } = Camp.valuePhotos(photos, target);
    const extra = Math.round(base * extraRate);
    const { bonus: bountyBonus, paid: bounties } = this.bounties.applySale(sold);
    const total = base + extra + bountyBonus;
    this.state.money += total;
    this.save();
    return { base, extra, sold, bountyBonus, bounties, total };
  }

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
  settleHunt({ outcome, photos, gearLeft, target, dawnBonus = 0 }) {
    const keptPhotos = outcome === 'complete' || outcome === 'abandoned';
    // Sell what you brought home: score value, the home-before-dawn bonus, then bounties (#45).
    const sale = keptPhotos ? this.sellPhotos(photos, target, { extraRate: dawnBonus })
      : { extra: 0, sold: [], bountyBonus: 0, bounties: [], total: 0 };
    const { sold, bounties, bountyBonus } = sale;
    const bonus = sale.extra;
    const total = sale.total;
    // Gear always comes home: what you carried at the end of the hunt is what camp owns.
    for (const [k, n] of Object.entries(gearLeft ?? {})) this.state.gear[k] = n;
    // Reputation (#47): bringing home a photo of the night's target earns +1, a great one (70+) +2.
    const best = sold.find((s) => s.subject === target)?.score ?? 0;
    const repGain = outcome === 'complete' && best > 0 ? (best >= CAMP.greatPhoto ? 2 : 1) : 0;
    this.state.reputation = (this.state.reputation ?? 0) + repGain;
    const entry = {
      n: this.state.hunts.length + 1, outcome, target,
      photosTaken: photos.length, photosLost: keptPhotos ? 0 : photos.length,
      sold, bonus, bounties, bountyBonus, earned: total, moneyAfter: this.state.money, gear: { ...this.state.gear }, repGain, reputation: this.state.reputation,
    };
    this.state.hunts.push(entry);
    if (this.state.hunts.length > 50) this.state.hunts.shift();
    this.save();
    return entry;
  }
}

export function gearList(gear) {
  return Object.entries(gear).filter(([, n]) => n > 0)
    .map(([k, n]) => (['camera', 'flashlight', 'nightVision', 'knockStick'].includes(k) ? GEAR_NAMES[k]
      : k === 'spareBatteries' ? `${n} spare batter${n > 1 ? 'ies' : 'y'}`
        : `${n} ${GEAR_NAMES[k] ?? k}${n > 1 && k !== 'bait' ? 's' : ''}`)).join(', ');
}

/** One-paragraph summary of a settled hunt for end screens and the camp panel. */
export function huntSummary(h) {
  if (!h) return '';
  const lost = h.photosLost ? `${h.photosLost} photo${h.photosLost > 1 ? 's' : ''} lost` : '';
  const why = { caught: 'Caught', dawn: 'Dawn broke', complete: 'Made it out', abandoned: 'Headed home' }[h.outcome] ?? h.outcome;
  const money = h.earned > 0 ? `+$${h.earned}` : 'no new earnings ($0)';
  return [`${why}${lost ? ` — ${lost}` : ''}: ${money}.`, ...h.sold.map((s) => `  ${s.subject} photo, score ${s.score}: $${s.value}`),
    ...(h.bonus ? [`  Home before dawn: +$${h.bonus}`] : []),
    ...(h.bounties ?? []).map((b) => `  Bounty claimed: ${b.title} (score ${b.minScore}+): +$${b.bonus}`), ...(h.repGain ? [`  Reputation +${h.repGain} (now ${h.reputation})`] : [])].join('\n');
}

/** BASE CAMP panel on the start screen: money, what happened last hunt, gear you own. */
export function showCampPanel(camp, root = document.querySelector('#overlay > div')) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'camp-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '10px 14px', border: '1px solid #7a6440', background: '#2b2116cc',
    color: '#f1e6c8', textAlign: 'left', whiteSpace: 'pre-wrap', font: '13px/1.5 monospace' });
  const s = camp.state, last = camp.lastHunt;
  el.textContent = [`BASE CAMP  ·  $${s.money}`,
    last ? `Last hunt (#${last.n}): ${huntSummary(last)}` : 'First night out. No photos sold yet.',
    `Gear: ${gearList(s.gear)}`].join('\n');
  root.prepend(el);
  // The start screen is taller now: let it scroll instead of spilling off the top.
  const overlay = root.parentElement;
  if (overlay) { overlay.style.alignItems = 'safe center'; overlay.style.overflowY = 'auto'; root.style.padding = '12px 0'; }
  return el;
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

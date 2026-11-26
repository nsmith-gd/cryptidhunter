// Base camp (L1): what carries over between hunts — money, owned gear and a log of past hunts.
// Photos are "unsaved evidence" until you make it back to the van: get caught (or let dawn
// catch you) and this hunt's photos are lost and earn nothing, but you keep your gear.
// Stored in localStorage (one key); falls back to memory if storage is unavailable.
// Money lives in the career ledger (economy/ledger.js, #97): integer cents CAD, one transaction per
// purchase or entitlement, each hunt settled once by attempt ID. camp.state.money is a read-through
// view of the ledger in dollars (setting it posts an adjustment, for tests and debugging only).
// The ledger is stored in the save file (save/saveService.js) and saved whenever it changes.

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
import { valueEvidence } from '../evidence/evidence.js';
import { Ledger, ECONOMY, cents, formatCAD } from '../economy/ledger.js';
import { classifyOutcome } from './expedition.js';

let memory = null;

export class Camp {
  constructor(storage = safeStorage(), saveService = new SaveService()) {
    this.storage = storage;
    this.saveService = saveService;
    // The save file is the source of truth for money (the ledger) and for paid bounties.
    const saved = this.saveService.load();
    this.ledger = Ledger.fromJSON(saved.ledger) ?? Camp.openLedger(saved.money);
    this.state = this.attachMoney(this.load());
    this.bounties = new BountyBoard({ completed: saved.bountiesDone ?? [] });
  }

  /** A new career: $250 savings; an older save's money (pre-ledger) above that carries over. */
  static openLedger(oldMoney = 0) {
    const l = new Ledger();
    if (oldMoney * 100 > ECONOMY.startCents) l.post('open:carryover', 'adjust', Math.round(oldMoney * 100) - ECONOMY.startCents, { memo: 'Savings from an older save' });
    return l;
  }

  /** state.money reads the ledger (dollars); it isn't stored in the camp state itself. */
  attachMoney(state) {
    delete state.money;
    Object.defineProperty(state, 'money', { enumerable: false, configurable: true,
      get: () => this.ledger.cash / 100,
      set: (v) => { this.ledger.setCash(cents(Number(v) || 0)); } });
    return state;
  }

  /** A fresh attempt ID (#98 commits one at departure; until then each settled hunt gets one). */
  newAttemptId() {
    this.state.attemptSeq = (this.state.attemptSeq ?? 0) + 1;
    return `A${this.state.attemptSeq}`;
  }

  static fresh() {
    return { gear: { ...CAMP.starter }, hunts: [], reputation: 0, map: null };
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
    this.saveService.save({ ...this.saveService.load(), money: Math.floor(this.ledger.cash / 100), ledger: this.ledger.toJSON(), bountiesDone: this.bounties?.completedIds ?? [] });
    const raw = JSON.stringify(this.state);
    memory = raw;
    try { this.storage?.setItem(CAMP.storageKey, raw); } catch { /* private mode etc. */ }
  }

  reset() { this.ledger = new Ledger(); this.state = this.attachMoney(Camp.fresh()); this.bounties = new BountyBoard(); this.save(); }

  /**
   * Sell evidence (#45): normal score-based value (best photo per cryptid), an optional extra
   * rate (home before dawn), then each sold photo is checked against the active bounties and any
   * it meets pay their bonus once. Adds the money and saves.
   * photos: [{ subject|cryptid, score }] (the camera's records today; #51's album later).
   */
  sellPhotos(photos, target, { extraRate = 0, attemptId = null, settle = true } = {}) {
    const aid = attemptId ?? this.newAttemptId();
    const { total: base, sold } = Camp.valuePhotos(photos, target);
    const extra = Math.round(base * extraRate);
    const { bonus: bountyBonus, paid: bounties } = this.bounties.applySale(sold);
    const total = base + extra + bountyBonus;
    // One entitlement per photo subject this attempt, the dawn bonus, and each bounty (paid once ever).
    const records = sold.map((p) => ({ id: `photo:${aid}:${p.subject}`, cents: cents(p.value), memo: `${p.subject} photo` }));
    const bonuses = [...(extra ? [{ id: `bonus:${aid}:dawn`, cents: cents(extra), memo: 'Home before dawn' }] : []),
      ...bounties.map((b) => ({ id: `bounty:${b.id}`, cents: cents(b.bonus), memo: `Bounty: ${b.title}` }))];
    const sale = { base, extra, sold, bountyBonus, bounties, total, records, bonuses };
    if (settle) { this.ledger.settleAttempt(aid, { records, bonuses }); this.save(); }
    return sale;
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
  settleHunt({ outcome, photos, gearLeft, target, dawnBonus = 0, evidence = [], attemptId = null, charges = [], leftBehind = [] }) {
    const aid = attemptId ?? this.newAttemptId();
    const keptPhotos = outcome === 'complete' || outcome === 'abandoned' || outcome === 'emergency';
    // Physical evidence (#73): what you drove home with sells at base value × novelty; otherwise it's lost.
    const evidenceSold = keptPhotos ? valueEvidence(evidence) : [];
    const evidenceValue = evidenceSold.reduce((a, e) => a + e.value, 0);
    for (const e of evidence) e.stage = keptPhotos ? 'sold' : 'lost';
    // Sell what you brought home: score value, the home-before-dawn bonus, then bounties (#45).
    const sale = keptPhotos ? this.sellPhotos(photos, target, { extraRate: dawnBonus, attemptId: aid, settle: false })
      : { extra: 0, sold: [], bountyBonus: 0, bounties: [], total: 0, records: [], bonuses: [] };
    // One settlement per attempt in the ledger: nothing is paid for records you didn't drive home.
    const evRecords = evidenceSold.map((e) => ({ id: `ev:${aid}:${e.id}`, cents: cents(e.value), memo: e.name }));
    const settlement = this.ledger.settleAttempt(aid, { records: [...evRecords, ...sale.records], bonuses: sale.bonuses, extracted: keptPhotos, charges });
    const outcomeClass = classifyOutcome({ huntOutcome: outcome, targetPhoto: keptPhotos && sale.sold.some((p) => p.subject === target),
      evidence: evidenceSold.length, photos: sale.sold.length });
    const { sold, bounties, bountyBonus } = sale;
    const bonus = sale.extra;
    const total = sale.total + evidenceValue;
    // Gear always comes home: what you carried at the end of the hunt is what camp owns.
    for (const [k, n] of Object.entries(gearLeft ?? {})) this.state.gear[k] = n;
    // Reputation (#47): bringing home a photo of the night's target earns +1, a great one (70+) +2.
    const best = sold.find((s) => s.subject === target)?.score ?? 0;
    const repGain = outcome === 'complete' && best > 0 ? (best >= CAMP.greatPhoto ? 2 : 1) : 0;
    this.state.reputation = (this.state.reputation ?? 0) + repGain;
    const entry = {
      n: this.state.hunts.length + 1, outcome, outcomeClass, target, attemptId: aid, settledCents: settlement.closing - settlement.opening,
      // Debrief (GDD 7.5), all in cents from the ledger: payouts, bonuses, the trip, charges, closing cash.
      ledger: { gross: settlement.gross, bonus: settlement.bonus, expense: settlement.expense ?? 0,
        charges: (settlement.charges ?? []).reduce((a, c) => a + c.collected, 0), waived: (settlement.charges ?? []).reduce((a, c) => a + c.waived, 0),
        opening: settlement.opening, closing: settlement.closing, duplicate: !!settlement.duplicate },
      leftBehind,
      photosTaken: photos.length, photosLost: keptPhotos ? 0 : photos.length,
      evidenceSold: evidenceSold.map((e) => ({ name: e.name, cryptid: e.cryptid, value: e.value, novelty: e.novelty })),
      evidenceLost: keptPhotos ? 0 : evidence.length,
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
  const lostParts = [h.photosLost ? `${h.photosLost} photo${h.photosLost > 1 ? 's' : ''}` : '',
    h.evidenceLost ? `${h.evidenceLost} evidence item${h.evidenceLost > 1 ? 's' : ''}` : ''].filter(Boolean);
  const lost = lostParts.length ? `${lostParts.join(' and ')} lost` : '';
  const why = { caught: 'Caught', dawn: 'Dawn broke', complete: 'Made it out', abandoned: 'Headed home', emergency: 'Evacuated' }[h.outcome] ?? h.outcome;
  const money = h.earned > 0 ? `+$${h.earned}` : 'no new earnings ($0)';
  return [`${why}${lost ? ` — ${lost}` : ''}: ${money}.`, ...h.sold.map((s) => `  ${s.subject} photo, score ${s.score}: $${s.value}`),
    ...(h.evidenceSold ?? []).map((e) => `  ${e.name} (${e.cryptid})${e.novelty < 1 ? ', repeat' : ''}: $${e.value}`),
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
  el.textContent = [`BASE CAMP  ·  ${formatCAD(camp.ledger.cash)}`,
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

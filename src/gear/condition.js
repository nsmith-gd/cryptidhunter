// Equipment condition and repair (#106; GDD 1.2 S11, 3.5, 4.3, 7.4).
//
// Durable kit has persistent item instances (instance ID, list price, condition 0..1). The ledger's
// owned-asset record is the single store of an instance's condition, so resale (floor(0.50 x list x
// condition)) and HQ repair (ceil(0.35 x list x condition restored), one ledger charge) read the
// same value. Condition drops from:
//   use     the camera per shot, the torch per minute lit, walking shoes per km walked
//   water   the camera dipped into water (raised while wading), shoes soaked while wading
//   impact  a thrown rock or a cryptid shoving you jars what you carry
// Condition changes capability only: a worn camera loses low-light clarity (its photo score is
// scaled), a worn torch throws a dimmer beam (and flickers when badly damaged), worn shoes slow you
// more in water. A damaged camera never loses the photos already on its card (GDD 4.3).
// Field repair kit (D10): 5 uses; each use restores up to 25% condition on the worst carried item,
// never above 75%, and can't fix catastrophic damage (below 10%).

import { resaleValue, repairCost, cents } from '../economy/ledger.js';

export const DURABLES = Object.freeze({
  camera: { code: 'F01', name: 'Used compact camera', price: 60 },
  flashlight: { code: 'C01', name: 'Pocket flashlight', price: 15 },
  shoes: { code: 'B02', name: 'Basic walking shoes', price: 40 },
});

export const WEAR = Object.freeze({
  cameraPerShot: 0.004,
  cameraDunk: 0.4,            // dipped into water
  torchPerMinute: 0.004,
  shoesPerKm: 0.03,
  shoesWetPerSecond: 0.0015,  // wading
  impact: { camera: 0.2, flashlight: 0.15, shoes: 0.05 },
  lowLightPenalty: 0.5,       // camera at 0 condition: night photo score x 0.5
  catastrophic: 0.1,
});

export const REPAIR_KIT = Object.freeze({ code: 'D10', name: 'Field repair kit', price: 30, uses: 5, restore: 0.25, cap: 0.75 });

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The camp's durable instances: ensure the starter kit exists as owned assets in the ledger. */
// Kept in their own list (camp.state.durables) apart from the supplier's catalogue purchases
// (camp.state.owned); the ledger's asset record is shared and holds the condition.
export function ensureInstances(camp) {
  camp.state.durables ??= [];
  const out = {};
  for (const [key, d] of Object.entries(DURABLES)) {
    let o = camp.state.durables.find((x) => x.kind === key && !x.gone);
    if (!o) {
      const instanceId = `gear:${d.code}:starter`;
      camp.ledger.addAsset(instanceId, cents(d.price), 1);
      o = { instanceId, id: d.code, kind: key, condition: 1, starter: true };
      camp.state.durables.push(o);
    }
    out[key] = o;
  }
  return out;
}

export class Equipment {
  constructor(camp) {
    this.camp = camp;
    this.items = ensureInstances(camp);
    this.log = [];                         // { item, cause, amount }
    this.wet = {};
  }

  asset(key) { return this.camp.ledger.assets[this.items[key].instanceId]; }
  condition(key) { return this.asset(key)?.condition ?? 1; }

  /** Apply wear (cause: use | water | impact). Returns the new condition. */
  wear(key, amount, cause = 'use') {
    const a = this.asset(key);
    if (!a || amount <= 0) return this.condition(key);
    const before = a.condition;
    a.condition = clamp01(a.condition - amount);
    this.items[key].condition = a.condition;
    if (before - a.condition > 0) this.log.push({ item: key, cause, amount: +(before - a.condition).toFixed(4) });
    return a.condition;
  }

  dunk(key = 'camera') {
    this.wet[key] = true;
    return this.wear(key, key === 'camera' ? WEAR.cameraDunk : 0.1, 'water');
  }

  impact() { for (const [k, v] of Object.entries(WEAR.impact)) this.wear(k, v, 'impact'); }

  // ---- what condition changes (capability only) ----------------------------------------------
  /** Multiplier on a night photo's score: a worn camera loses low-light clarity. */
  get cameraClarity() { return 1 - WEAR.lowLightPenalty * (1 - this.condition('camera')); }
  /** Torch beam strength multiplier. */
  get torchOutput() { return 0.55 + 0.45 * this.condition('flashlight'); }
  /** Extra slowdown in water from worn shoes (1 = none). */
  get wadeFactor() { return 0.85 + 0.15 * this.condition('shoes'); }

  // ---- repair --------------------------------------------------------------------------------
  /** Field repair kit: restore the worst eligible item by up to 25% (never above 75%, not if catastrophic). */
  fieldRepair(kit) {
    if (!kit || kit.uses <= 0) return { ok: false, reason: 'no repair kit uses left' };
    const keys = Object.keys(this.items).filter((k) => this.condition(k) < REPAIR_KIT.cap && this.condition(k) >= WEAR.catastrophic)
      .sort((a, b) => this.condition(a) - this.condition(b));
    if (!keys.length) {
      const broken = Object.keys(this.items).find((k) => this.condition(k) < WEAR.catastrophic);
      return { ok: false, reason: broken ? `${DURABLES[broken].name} is too badly damaged for a field repair` : 'nothing the kit can improve' };
    }
    const k = keys[0], a = this.asset(k), before = a.condition;
    a.condition = Math.min(REPAIR_KIT.cap, a.condition + REPAIR_KIT.restore);
    this.items[k].condition = a.condition;
    kit.uses--;
    return { ok: true, item: k, from: before, to: a.condition, usesLeft: kit.uses };
  }

  /** HQ quote for one item: resale now, and the cost of a full repair. */
  quote(key) {
    const a = this.asset(key);
    return { condition: a.condition, resaleCents: resaleValue(a.list, a.condition, a.repaired), repairCents: repairCost(a.list, 1 - a.condition), listCents: a.list };
  }

  /** HQ repair: one ledger charge, restores to full. Drying is free (wetness cleared). */
  repair(key) {
    const r = this.camp.ledger.repair(this.items[key].instanceId, 1);
    if (r.ok) { this.items[key].condition = this.condition(key); this.wet[key] = false; this.camp.save(); }
    return r;
  }
}

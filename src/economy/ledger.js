// Career ledger (GDD 3.7, 6.4, 7.1, 7.4, gym G08). Headless and deterministic: no DOM, no clock,
// no randomness. All money is integer cents in CAD.
//
//   Available cash   spendable, never below zero (a charge that doesn't fit is refused)
//   Reserved funds   refundable rental deposits (20% of the rental fee), held apart from cash
//   Transactions     one per unique entitlement or charge ID; posting the same ID again is a no-op
//                    that returns the original (so a retried purchase or payout never doubles)
//   Attempts         an expedition attempt ID is debited once on commit and settled once; settling
//                    it again (e.g. an interrupted debrief retried) returns the first settlement.
//
// Resale  = floor(0.50 × list × condition)   (unrepaired condition)
// Repair  = ceil(0.35 × list × condition restored), capped at the list price.
// The GDD forbids resale arbitrage (repair then sell for a profit). Repaired condition is usable
// in the field but resells at the repair rate (0.35 of list), so with floor/ceil rounding a
// repair-then-sell always nets <= 0.

export const ECONOMY = Object.freeze({
  startCents: 25000,                 // $250 starting savings (7.1)
  tripCostCents: { L01: 2500 },      // L01 operating cost $25 (3.7); later levels add rows
  depositRate: 0.20,                 // rental deposit = 20% of the quoted fee (7.4)
  resaleRate: 0.50,
  repairRate: 0.35,
});

export const cents = (dollars) => Math.round(dollars * 100);
export const dollars = (c) => c / 100;
/** "$250", "$12.50", "-$25" */
export function formatCAD(c) {
  const sign = c < 0 ? '-' : '', a = Math.abs(c);
  return `${sign}$${a % 100 ? (a / 100).toFixed(2) : a / 100}`;
}

export const resaleValue = (listCents, condition, repaired = 0) => {
  const fresh = Math.max(0, Math.min(1, condition) - repaired);
  return Math.floor(listCents * (ECONOMY.resaleRate * fresh + Math.min(ECONOMY.resaleRate, ECONOMY.repairRate) * repaired));
};
export const repairCost = (listCents, restored) =>
  Math.min(listCents, Math.ceil(ECONOMY.repairRate * listCents * Math.max(0, restored)));

const isInt = (n) => Number.isSafeInteger(n);

export class Ledger {
  constructor({ startCents = ECONOMY.startCents, open = true } = {}) {
    this.cash = 0;                 // available cents
    this.reserved = {};            // rentalId -> { deposit, fee, returned }
    this.tx = [];                  // { id, kind, cents, attemptId?, memo, seq }
    this.ids = new Map();          // id -> tx
    this.attempts = {};            // attemptId -> { tripCents, state: 'committed'|'settled', settlement? }
    this.assets = {};              // instanceId -> { list, condition, repaired, sold }
    this.seq = 0;
    if (open) this.post('open:start', 'start', startCents, { memo: 'Starting savings' });
  }

  // ---- core posting -------------------------------------------------------------------------
  /**
   * Post one transaction. `amount` > 0 adds to cash, < 0 spends it. Same id twice -> the first tx,
   * unchanged ({ ok: true, duplicate: true }). A spend that would take cash below zero is refused.
   */
  post(id, kind, amount, { attemptId = null, memo = '' } = {}) {
    if (typeof id !== 'string' || !id) throw new Error('transaction id required');
    if (!isInt(amount)) throw new Error(`amount must be integer cents (${id}: ${amount})`);
    const prev = this.ids.get(id);
    if (prev) return { ok: true, duplicate: true, tx: prev };
    if (this.cash + amount < 0) return { ok: false, reason: `need ${formatCAD(-amount)}, have ${formatCAD(this.cash)}` };
    const tx = { id, kind, cents: amount, attemptId, memo, seq: ++this.seq };
    this.cash += amount;
    this.tx.push(tx);
    this.ids.set(id, tx);
    return { ok: true, tx };
  }

  has(id) { return this.ids.has(id); }
  get dollars() { return dollars(this.cash); }
  get reservedCents() { return Object.values(this.reserved).reduce((a, r) => a + (r.returned ? 0 : r.deposit), 0); }

  /** Next free id with this prefix (for repeatable actions like buying another bait). */
  nextId(prefix) { let n = 1; while (this.ids.has(`${prefix}:${n}`)) n++; return `${prefix}:${n}`; }

  /** Buy something: one charge. Refused (nothing changes) if it can't be afforded. */
  purchase(id, priceCents, memo = '') { return this.post(id, 'purchase', -priceCents, { memo }); }

  /** Developer/test adjustment that sets the cash to an exact amount (recorded as its own tx). */
  setCash(targetCents, memo = 'adjustment') {
    const t = Math.max(0, Math.round(targetCents));
    if (t === this.cash) return { ok: true };
    return this.post(this.nextId('adjust'), 'adjust', t - this.cash, { memo });
  }

  // ---- expedition attempts ------------------------------------------------------------------
  /** Commit an attempt: debit its trip cost once. Committing the same attempt again is a no-op. */
  commitAttempt(attemptId, tripCents, { waive = false } = {}) {
    const a = this.attempts[attemptId];
    if (a) return { ok: true, duplicate: true, attempt: a };
    const charge = waive ? 0 : tripCents;
    const r = this.post(`trip:${attemptId}`, 'trip', -charge, { attemptId, memo: waive ? 'Trip cost waived' : 'Trip cost' });
    if (!r.ok) return r;
    this.attempts[attemptId] = { tripCents: charge, state: 'committed', settlement: null };
    return { ok: true, attempt: this.attempts[attemptId] };
  }

  /**
   * Settle an attempt once. records: [{ id (entitlement), cents, extracted }]; only extracted records
   * pay, and an entitlement already paid (this or any earlier attempt) pays nothing.
   * charges: [{ id, cents, memo }] documented charges (e.g. emergency): collected up to available
   * cash, the rest waived (no debt). Returns the settlement; a second call returns the same one.
   */
  settleAttempt(attemptId, { records = [], bonuses = [], charges = [], extracted = true } = {}) {
    const a = this.attempts[attemptId] ?? (this.attempts[attemptId] = { tripCents: 0, state: 'committed', settlement: null });
    if (a.state === 'settled') return { ...a.settlement, duplicate: true };
    const opening = this.cash;
    const paid = [], skipped = [];
    for (const r of [...records, ...bonuses]) {
      if (!extracted || r.extracted === false) { skipped.push({ id: r.id, reason: 'not extracted' }); continue; }
      if (!isInt(r.cents) || r.cents <= 0) { skipped.push({ id: r.id, reason: 'no value' }); continue; }
      const res = this.post(`pay:${r.id}`, r.bonus || bonuses.includes(r) ? 'bonus' : 'payout', r.cents, { attemptId, memo: r.memo ?? '' });
      if (res.duplicate) skipped.push({ id: r.id, reason: 'already paid' }); else paid.push(res.tx);
    }
    const collected = [];
    for (const c of charges) {
      const take = Math.min(c.cents, this.cash);
      const res = this.post(`charge:${attemptId}:${c.id}`, 'charge', -take, { attemptId, memo: c.memo ?? '' });
      collected.push({ id: c.id, quoted: c.cents, collected: res.duplicate ? -res.tx.cents : take, waived: c.cents - take });
    }
    const gross = paid.filter((t) => t.kind === 'payout').reduce((s, t) => s + t.cents, 0);
    const bonus = paid.filter((t) => t.kind === 'bonus').reduce((s, t) => s + t.cents, 0);
    a.state = 'settled';
    a.settlement = { attemptId, opening, gross, bonus, charges: collected, expense: a.tripCents, paid: paid.map((t) => t.id), skipped, closing: this.cash };
    return a.settlement;
  }

  // ---- rentals and deposits -----------------------------------------------------------------
  /** Rent: pay the fee and hold a 20% deposit apart from cash (both refused together if short). */
  rent(rentalId, feeCents) {
    if (this.reserved[rentalId]) return { ok: true, duplicate: true, rental: this.reserved[rentalId] };
    const deposit = Math.round(feeCents * ECONOMY.depositRate);
    if (this.cash < feeCents + deposit) return { ok: false, reason: `need ${formatCAD(feeCents + deposit)}` };
    this.post(`rent:${rentalId}`, 'rental', -feeCents, { memo: 'Rental fee' });
    this.post(`deposit:${rentalId}`, 'deposit', -deposit, { memo: 'Deposit held' });
    this.reserved[rentalId] = { fee: feeCents, deposit, returned: false };
    return { ok: true, rental: this.reserved[rentalId] };
  }

  /** Return a deposit minus assessed damage (capped at the deposit). Once only. */
  returnDeposit(rentalId, damageCents = 0) {
    const r = this.reserved[rentalId];
    if (!r) return { ok: false, reason: 'no such rental' };
    if (r.returned) return { ok: true, duplicate: true, refunded: r.refunded };
    const kept = Math.min(r.deposit, Math.max(0, Math.round(damageCents)));
    r.refunded = r.deposit - kept;
    r.returned = true;
    this.post(`deposit-return:${rentalId}`, 'deposit-return', r.refunded, { memo: kept ? `Deposit returned less ${formatCAD(kept)} damage` : 'Deposit returned' });
    return { ok: true, refunded: r.refunded, kept };
  }

  // ---- owned gear: resale and repair --------------------------------------------------------
  addAsset(instanceId, listCents, condition = 1) {
    this.assets[instanceId] ??= { list: listCents, condition, repaired: 0, sold: false };
    return this.assets[instanceId];
  }

  sell(instanceId) {
    const g = this.assets[instanceId];
    if (!g) return { ok: false, reason: 'not owned' };
    if (g.sold) return { ok: true, duplicate: true, cents: this.ids.get(`resale:${instanceId}`)?.cents ?? 0 };
    const value = resaleValue(g.list, g.condition, g.repaired);
    g.sold = true;
    this.post(`resale:${instanceId}`, 'resale', value, { memo: 'Gear sold' });
    return { ok: true, cents: value };
  }

  repair(instanceId, toCondition = 1) {
    const g = this.assets[instanceId];
    if (!g || g.sold) return { ok: false, reason: 'not owned' };
    const restored = Math.max(0, Math.min(1, toCondition) - g.condition);
    if (restored <= 0) return { ok: false, reason: 'nothing to repair' };
    const cost = repairCost(g.list, restored);
    const r = this.post(this.nextId(`repair:${instanceId}`), 'repair', -cost, { memo: 'Repair' });
    if (!r.ok) return r;
    g.condition += restored; g.repaired += restored;
    return { ok: true, cents: cost };
  }

  // ---- persistence --------------------------------------------------------------------------
  toJSON() {
    return { v: 1, cash: this.cash, seq: this.seq, tx: this.tx, reserved: this.reserved, attempts: this.attempts, assets: this.assets };
  }

  /** Rebuild from a save. Cash is recomputed from the transactions (they are the truth). */
  static fromJSON(o) {
    const l = new Ledger({ open: false });
    if (!o || !Array.isArray(o.tx)) return null;
    for (const t of o.tx) {
      if (!t || typeof t.id !== 'string' || !isInt(t.cents) || l.ids.has(t.id)) continue;
      l.tx.push(t); l.ids.set(t.id, t); l.cash += t.cents; l.seq = Math.max(l.seq, t.seq ?? 0);
    }
    if (l.cash < 0) return null;
    l.reserved = o.reserved && typeof o.reserved === 'object' ? o.reserved : {};
    l.attempts = o.attempts && typeof o.attempts === 'object' ? o.attempts : {};
    l.assets = o.assets && typeof o.assets === 'object' ? o.assets : {};
    return l;
  }

  /** Conservation check: cash equals the sum of every transaction and is never negative. */
  audit() {
    const sum = this.tx.reduce((a, t) => a + t.cents, 0);
    let run = 0, neverNegative = true;
    for (const t of this.tx) { run += t.cents; if (run < 0) neverNegative = false; }
    return { ok: sum === this.cash && this.cash >= 0 && neverNegative && new Set(this.tx.map((t) => t.id)).size === this.tx.length, sum, cash: this.cash };
  }
}

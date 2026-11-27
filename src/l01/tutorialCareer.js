// L01 tutorial career rules (GDD 1.5 L01, 6.2, 6.6 #1, 7.1, 9 "Tutorial death"). Headless: no DOM.
//
//   Start of career      $250 cash (the ledger's opening balance), fixed owned starter kit.
//   Entering the tunnel  commits an attempt: the $25 trip cost is debited once per attempt.
//   First attempt        the entrance stair collapses behind you (until the tutorial is cleared).
//   Tutorial death       restarts at the tunnel entry with the same kit and the same post-entry
//                        cash: the same attempt is resumed, so no second entry fee is charged.
//   Escape               settles the attempt once. Escaping with no evidence is enough: it clears
//                        the tutorial and unlocks the next trip (L02 Sidehill Gouger).
//   Optional evidence    a recovered trace pays its provisional L01 value (GDD 4.x example:
//                        compelling physical trace $30) once per evidence event, inside the $250
//                        per-attempt ceiling.
//
// state is a plain object persisted by the caller (camp.state.l01 in the game, an in-memory
// fixture in the G01 gym): { attempts, cleared, unlocked, open: { id, died } | null, history }.

export const L01 = Object.freeze({
  tripCents: 2500,                 // $25 operating cost (GDD 1.5)
  ceilingCents: 25000,             // $250 maximum payout per attempt
  next: { id: 'L02', name: 'Sidehill Gouger', place: 'Oro-Medonte, ON' },
  evidence: { fur: { cents: 3000, label: 'Fur sample (compelling physical trace)' } },
  kit: ['Everyday jacket', 'Walking shoes', 'Dry clothes', '12 L pack', 'Packed lunch', 'Flashlight', 'Camera', 'Sketchbook', 'Sample pouch'],
});

export const freshL01 = () => ({ attempts: 0, cleared: false, unlocked: [], open: null, history: [] });

export class TutorialCareer {
  /** ledger: economy/ledger.js Ledger. state: the persisted L01 record. newId: () => attempt ID. */
  constructor({ ledger, state, newId }) {
    this.ledger = ledger;
    this.s = state;
    this.newId = newId;
  }

  get cleared() { return this.s.cleared; }
  /** The entrance stair collapses on the first attempt (and on its retries) until you have escaped once. */
  get entranceCollapses() { return !this.s.cleared; }

  /**
   * Enter the tunnels. A died-in attempt that hasn't been settled is resumed (no fee); otherwise a
   * new attempt is committed and its trip cost debited. Returns { ok, attemptId, resumed, charged }.
   */
  enter() {
    const o = this.s.open;
    if (o && o.died && !this.s.cleared) {
      o.died = false; o.retries = (o.retries ?? 0) + 1;
      return { ok: true, attemptId: o.id, resumed: true, charged: 0, cash: this.ledger.cash };
    }
    if (o && !o.died) return { ok: true, attemptId: o.id, resumed: true, charged: 0, cash: this.ledger.cash };   // reload mid-attempt
    const id = this.newId();
    const r = this.ledger.commitAttempt(id, L01.tripCents);
    if (!r.ok) return { ok: false, reason: `You can't afford the $${L01.tripCents / 100} trip.`, cash: this.ledger.cash };
    this.s.attempts++;
    this.s.open = { id, died: false, retries: 0, postEntryCents: this.ledger.cash };
    return { ok: true, attemptId: id, resumed: false, charged: L01.tripCents, cash: this.ledger.cash };
  }

  /** You died in the tunnels: on the tutorial the attempt stays open and the next entry resumes it. */
  die(cause) {
    const o = this.s.open;
    if (!o) return null;
    if (this.s.cleared) {
      // After the tutorial, an ordinary death settles the attempt with nothing extracted.
      const st = this.ledger.settleAttempt(o.id, { extracted: false });
      this.s.history.push({ id: o.id, outcome: 'died', cause });
      this.s.open = null;
      return { tutorialRetry: false, settlement: st };
    }
    o.died = true;
    this.s.history.push({ id: o.id, outcome: 'died (tutorial retry)', cause });
    return { tutorialRetry: true, cashKept: this.ledger.cash };
  }

  /**
   * You climbed out. evidence: [{ kind: 'fur', eventId }] recovered. Settles the attempt once:
   * pays each evidence event once, clears the tutorial and unlocks the next trip.
   */
  escape(evidence = [], via = 'ladder') {
    const o = this.s.open;
    if (!o) return null;
    let room = L01.ceilingCents;
    const records = evidence.map((e) => {
      // A graded photo (#123) brings its own offer (cents, label); traces use the fixed L01 values.
      const v = Math.min(e.cents ?? L01.evidence[e.kind]?.cents ?? 0, room);
      room -= v;
      return { id: `L01:${e.kind}:${e.eventId}`, cents: v, memo: e.label ?? L01.evidence[e.kind]?.label ?? e.kind };
    });
    const settlement = this.ledger.settleAttempt(o.id, { records });
    const firstClear = !this.s.cleared;
    this.s.cleared = true;
    if (!this.s.unlocked.includes(L01.next.id)) this.s.unlocked.push(L01.next.id);
    this.s.history.push({ id: o.id, outcome: 'escaped', via, evidence: evidence.map((e) => e.kind) });
    this.s.open = null;
    return { settlement, firstClear, unlocked: L01.next };
  }
}

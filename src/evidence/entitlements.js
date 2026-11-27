// Event-based evidence entitlements and the per-attempt settlement cap (#100; GDD 4.7, 7, 9.x).
// Pure: no three.js, no DOM. The ledger is a plain serialisable object kept in the save.
//
// An entitlement is one evidence type documenting one observation event (eventId). Different types
// of the same event are separate entitlements; two records of the same type and event are one.
//   duplicate        same type + event already paid at this grade or better -> $0
//   upgrade          same type + event, better grade -> only the positive increment over what was paid
//   new event        pays at novelty N: 1, 0.5, then 0.25 (floor) for each further new event of the
//                    same type and cryptid, across attempts
// offer = round_half_up(T x 0.01 x B x M x N x A)   T level ceiling, B base units, M grade multiplier,
//                                                   A buyer affinity (0.8-1.2, default 1)
// Everything paid in one attempt (evidence first, then bonuses) is clipped to the ceiling T.

export function emptyEntitlements() { return { paid: {}, events: {} }; }

export function offer({ T, B, M, N = 1, A = 1 }) {
  return Math.floor(T * 0.01 * B * M * N * A + 0.5 + 1e-9);
}

const clampA = (A, cfg) => Math.max(cfg.affinity.min, Math.min(cfg.affinity.max, A ?? cfg.affinity.default));

/**
 * Settle one attempt's verified entries against the ledger.
 *   ledger   { paid: { [type|eventId]: { M, N, value, grade, attemptId } }, events: { [type|species]: n } }
 *   entries  [{ id, type, species, eventId, B, M, grade, A? }]   (M 0 = rejected / inconclusive)
 *   bonuses  [{ id, memo, value }]                               (dawn, bounties: share the ceiling)
 *   cfg      { T, novelty: [1, 0.5, 0.25], affinity: { min, max, default } }
 * Returns { ledger (new object), lines, total, ceiling, clipped } without mutating the input.
 * lines: [{ id, kind: 'new'|'upgrade'|'duplicate'|'rejected'|'bonus', value, gross, N, clip, note }]
 */
export function settleEntitlements(ledger, entries, { attemptId = null, bonuses = [], cfg }) {
  const next = { paid: { ...(ledger?.paid ?? {}) }, events: { ...(ledger?.events ?? {}) } };
  const T = cfg.T;
  // Best entry per entitlement this attempt; the rest are duplicates of it.
  const best = new Map();
  for (const e of entries) {
    const k = `${e.type}|${e.eventId}`;
    const b = best.get(k);
    if (!b || e.M > b.M) best.set(k, e);
  }
  const lines = [];
  let total = 0, clipped = 0;
  const pay = (line, gross) => {
    const room = Math.max(0, T - total);
    const value = Math.min(gross, room);
    if (value < gross) { line.clip = gross - value; clipped += gross - value; }
    total += value;
    return Object.assign(line, { gross, value });
  };
  for (const e of entries) {
    const k = `${e.type}|${e.eventId}`;
    const A = clampA(e.A, cfg);
    if (!(e.M > 0)) { lines.push({ id: e.id, kind: 'rejected', value: 0, gross: 0, N: 0 }); continue; }
    if (best.get(k) !== e) { lines.push({ id: e.id, kind: 'duplicate', value: 0, gross: 0, N: 0, note: 'same event as another record' }); continue; }
    const prior = next.paid[k];
    if (prior) {
      const full = offer({ T, B: e.B, M: e.M, N: prior.N, A });
      const inc = full - prior.value;
      if (inc <= 0) { lines.push({ id: e.id, kind: 'duplicate', value: 0, gross: 0, N: prior.N, note: 'already paid' }); continue; }
      const line = pay({ id: e.id, kind: 'upgrade', N: prior.N }, inc);
      next.paid[k] = { ...prior, M: e.M, grade: e.grade, value: prior.value + line.value, attemptId };
      lines.push(line);
      continue;
    }
    const g = `${e.type}|${e.species}`;
    const n = next.events[g] ?? 0;
    const N = cfg.novelty[Math.min(n, cfg.novelty.length - 1)];
    const line = pay({ id: e.id, kind: 'new', N }, offer({ T, B: e.B, M: e.M, N, A }));
    next.events[g] = n + 1;
    next.paid[k] = { M: e.M, N, grade: e.grade, value: line.value, attemptId };
    lines.push(line);
  }
  for (const b of bonuses) lines.push(pay({ id: b.id, kind: 'bonus', memo: b.memo, N: 1 }, b.value));
  return { ledger: next, lines, total, ceiling: T, clipped };
}

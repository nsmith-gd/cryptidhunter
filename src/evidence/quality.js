// Evidence quality grades and HQ verification (#99; GDD 4.3-4.5, 4.7). Pure: no three.js, no DOM.
//
// Quality (GDD 4.5): four components 0-1 measured in the field (#85):
//   C clarity · I identification · K completeness · P provenance
//   Q = round(100 x (0.30C + 0.35I + 0.20K + 0.15P) x integrity), clamped 0-100
// Grade by Q, and the valuation multiplier M used for offers:
//   0 Inconclusive 0-19 (M 0) · 1 Weak 20-39 (0.25) · 2 Suggestive 40-59 (0.55)
//   3 Compelling 60-79 (0.80) · 4 Exceptional 80-100 (1.00)
// Every entry also gets a plain reason (what limited it, or why it's good).
//
// Authenticity is separate from quality (GDD 4.5: "quality is not authenticity"). Each record
// carries a hidden ground-truth source tag. HQ checks it deterministically against the claim:
//   known ordinary animal -> REJECTED for the cryptid claim, with the reason (however sharp)
//   a different cryptid    -> REJECTED for this claim
//   source can't be told   -> AMBIGUOUS: at most grade 1, no verified credibility
//   the claimed cryptid    -> ACCEPTED at its grade (grade 0 still pays nothing)
// The tag is never shown in the field; only the HQ verification screen reads it.

export const GRADES = Object.freeze([
  { grade: 0, name: 'Inconclusive', min: 0, M: 0 },
  { grade: 1, name: 'Weak', min: 20, M: 0.25 },
  { grade: 2, name: 'Suggestive', min: 40, M: 0.55 },
  { grade: 3, name: 'Compelling', min: 60, M: 0.8 },
  { grade: 4, name: 'Exceptional', min: 80, M: 1 },
]);

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** GDD 4.5 quality from the four components and integrity (0-100). */
export function qualityQ({ C, I, K, P }, integrity = 1) {
  return Math.max(0, Math.min(100, Math.round(100 * (0.30 * clamp01(C) + 0.35 * clamp01(I) + 0.20 * clamp01(K) + 0.15 * clamp01(P)) * clamp01(integrity))));
}

/** Grade row for a Q (thresholds 20/40/60/80, read literally: 19 is grade 0, 20 is grade 1). */
export function gradeOf(Q) {
  let g = GRADES[0];
  for (const row of GRADES) if (Q >= row.min) g = row;
  return g;
}

/**
 * Reasons, worst first. Uses the measured light and steadiness when present, else the components.
 * Returns ['too dark', 'blurry', ...] or ['clear and complete'] when nothing held it back.
 */
export function reasonsFor(q) {
  const out = [];
  const light = q.light ?? null, steady = q.steadiness ?? null;
  if ((light != null && light < 0.35) || (light == null && clamp01(q.C) < 0.3)) out.push('too dark');
  if ((steady != null && steady < 0.75) || (steady == null && light != null && clamp01(q.C) < light * 0.6)) out.push('blurry');
  if (clamp01(q.K) < 0.6) out.push('subject out of frame or hidden');
  if (clamp01(q.I) < 0.4 && !out.includes('too dark')) out.push('too small or far to make out');
  if (clamp01(q.P) < 0.5) out.push('no time and place on record');
  if ((q.integrity ?? 1) < 0.8) out.push('damaged');
  return out.length ? out : ['clear and complete'];
}

/** Quality result for one record: { Q, grade, gradeName, M, reason, reasons }. */
export function gradeRecord(record) {
  const q = record.quality ?? {};
  const Q = q.Q ?? qualityQ(q, q.integrity ?? 1);
  const g = gradeOf(Q);
  const reasons = reasonsFor(q);
  return { Q, grade: g.grade, gradeName: g.name, M: g.M, reasons, reason: reasons[0] };
}

// ---- authenticity ---------------------------------------------------------------------------
/** Ordinary animals a record can turn out to be (ground truth, hidden in the field). */
export const ORDINARY = Object.freeze({ deer: 'a deer', fox: 'a red fox', owl: 'a great horned owl' });

/**
 * The ground-truth source of a record as { origin: 'cryptid'|'ordinary'|'unknown', species }.
 * Accepts the structured tag (source.origin / source.species) and the older display string
 * (source.actual, e.g. 'deer (ordinary animal)' or 'Bigfoot').
 */
export function sourceOf(record) {
  const s = record.source ?? {};
  if (s.origin) return { origin: s.origin, species: s.species ?? null };
  const a = String(s.actual ?? record.cryptid ?? '').toLowerCase();
  if (!a) return { origin: 'unknown', species: null };
  const ord = Object.keys(ORDINARY).find((k) => a.includes(k));
  if (ord || a.includes('ordinary')) return { origin: 'ordinary', species: ord ?? 'animal' };
  return { origin: 'cryptid', species: a.replace(/\s*\(.*\)$/, '').trim() };
}

/**
 * HQ verification of one record against a claim (the cryptid you're documenting).
 * Returns { verdict: 'accepted'|'rejected'|'ambiguous', grade, gradeName, M, Q, reason, reasons }.
 * M is what an offer may use: 0 when rejected or grade 0, capped at grade 1's for ambiguous.
 */
export function verify(record, claim) {
  const q = gradeRecord(record);
  const src = sourceOf(record);
  const target = String(claim ?? '').toLowerCase();
  if (src.origin === 'ordinary') {
    return { ...q, verdict: 'rejected', M: 0, reason: `ordinary animal: ${ORDINARY[src.species] ?? 'an ordinary animal'}, not ${claim}` };
  }
  if (src.origin === 'cryptid' && target && src.species !== target) {
    return { ...q, verdict: 'rejected', M: 0, reason: `not ${claim}: the source is something else` };
  }
  if (src.origin === 'unknown') {
    const capped = Math.min(q.grade, 1);
    return { ...q, verdict: 'ambiguous', grade: capped, gradeName: GRADES[capped].name, M: GRADES[capped].M, reason: `source can't be identified (${q.reason})` };
  }
  if (q.grade === 0) return { ...q, verdict: 'accepted', M: 0, reason: `inconclusive: ${q.reason}` };
  return { ...q, verdict: 'accepted' };
}

// ---- offers (GDD 4.7) -------------------------------------------------------------------------
// offer = T x 0.01 x B x M x N x A, rounded half up, in dollars.
//   T  the level's maximum payout per attempt (L01 $250, L02 $600)
//   B  base reward units of the evidence type (GDD 4.2: creature photo 35, footprint photo 10, ...)
//   M  the grade multiplier from HQ verification (0 when rejected)
//   N  novelty: 1, 0.5, 0.25 (floor) for each new event of the same type and cryptid
//   A  buyer adjustment (1 until #100 brings buyers)
// Physical samples have no measured quality yet: they're graded Compelling (3), the GDD's own
// example ("compelling physical trace $30" at L01). Assumption, noted in the PR.
export const PAYOUT = Object.freeze({
  maxByMap: { test: 250, forest: 250, swamp: 600 },
  creaturePhotoBase: 35,
  assumedGrade: 3,
  novelty: [1, 0.5, 0.25],
});

export function offer({ T, B, M, N = 1, A = 1 }) {
  return Math.floor(T * 0.01 * B * M * N * A + 0.5 + 1e-9);
}

/**
 * HQ verification and valuation of everything brought home from one attempt.
 *   records  creature photo records ({ id, kind:'creature', eventId, quality, source })
 *   items    extracted evidence items ({ id, type, name, B, cryptid, quality?, source, eventId? })
 *   target   the night's cryptid (what an ordinary or unknown sign is claimed as)
 * Each event is judged once: the best entry of an event pays, the rest are 'same event'.
 * Returns entries in the order given: { id, kind, name, subject, eventId, B, verdict, grade,
 * gradeName, M, Q, reason, novelty, value }.
 */
export function appraise({ records = [], items = [], target, T = PAYOUT.maxByMap.forest }) {
  const rows = [
    ...records.map((r) => ({ id: r.id, kind: 'photo', type: 'creaturePhoto', name: 'Creature photo', B: PAYOUT.creaturePhotoBase, eventId: r.eventId ?? r.id, rec: r })),
    ...items.map((i) => ({ id: i.id, kind: 'item', type: i.type, name: i.name, B: i.B ?? 0, eventId: i.eventId ?? `${i.type}:${i.clueId ?? i.id}`,
      assumed: !i.quality, rec: i.quality ? i : { ...i, quality: { Q: GRADES[PAYOUT.assumedGrade].min + 10, light: 1, steadiness: 1, C: 1, I: 1, K: 1, P: 1 } } })),
  ];
  for (const row of rows) {
    const src = sourceOf(row.rec);
    const claim = src.origin === 'cryptid' ? (row.rec.cryptid ?? src.species) : target;
    const v = verify(row.rec, src.origin === 'cryptid' ? src.species : claim);
    const subject = src.origin === 'cryptid' ? (row.rec.cryptid && row.rec.cryptid !== '?' ? row.rec.cryptid : cap(src.species)) : target;
    Object.assign(row, { subject, verdict: v.verdict, grade: v.grade, gradeName: v.gradeName, M: v.M, Q: v.Q, reason: v.reason, reasons: v.reasons });
    if (row.assumed && v.verdict === 'accepted') row.reason = 'physical sample in good condition';
    if (src.origin !== 'cryptid' && v.verdict === 'rejected') row.reason = v.reason.replace(/, not .*$/, `, not ${target}`);
  }
  // Best entry per event pays; others are the same event.
  const best = new Map();
  for (const r of rows) { const b = best.get(r.eventId); if (!b || r.M > b.M) best.set(r.eventId, r); }
  const seen = new Map();
  for (const r of rows) {
    if (best.get(r.eventId) !== r) { Object.assign(r, { novelty: 0, value: 0, reason: `same event as another entry (${r.reason})` }); continue; }
    if (r.M <= 0) { Object.assign(r, { novelty: 0, value: 0 }); continue; }
    const key = `${r.type}:${r.subject}`;
    const n = seen.get(key) ?? 0; seen.set(key, n + 1);
    r.novelty = PAYOUT.novelty[Math.min(n, PAYOUT.novelty.length - 1)];
    r.value = offer({ T, B: r.B, M: r.M, N: r.novelty });
  }
  return rows.map(({ rec, assumed, ...r }) => r);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

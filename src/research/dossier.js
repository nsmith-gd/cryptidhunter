// Research dossier, milestones and credibility (#101; GDD 4.6, 6.4, 7.1-7.2).
//
// The field journal becomes a per-species dossier. Its milestones are separate from evidence
// grades and are only earned from attempts you EXTRACTED from (field notes persist on extraction):
//   Lead          witness report: the case you start with (no credibility)
//   Located       one verified target-associated sign, or two independent compatible ambiguous signs
//   Documented    one accepted record of the target at grade 2 or better
//   Characterized two independent verified behaviour findings
//   Confirmed     accepted evidence from >= 2 independent events and >= 2 evidence families, with a
//                 confidence score >= 90 (sum over events of the event's best Q x D, each event
//                 contributing at most 70; unrounded)
//   Tagged / Captured  later levels (9 / 10); never needed to progress
// Each milestone awards credibility once: Located 1, Documented 2, Characterized 2, Confirmed 3,
// Tagged 2, Captured 4. Credibility is a career total, never spent. An ambiguous record on its own
// (low grade, unverified, or not clearly the target) moves nothing and earns nothing.
//
// Unlocks (6.4/7.1): the next destination opens after a successful extraction from the previous one
// plus its target's Documented milestone, and only if you can afford the trip. Buyers (7.2) unlock
// by expedition reached and credibility; the enthusiast buyer is always available.

export const MILESTONES = ['lead', 'located', 'documented', 'characterized', 'confirmed', 'tagged', 'captured'];
export const MILESTONE_NAMES = { lead: 'Lead', located: 'Located', documented: 'Documented', characterized: 'Characterized', confirmed: 'Confirmed', tagged: 'Tagged', captured: 'Captured' };
export const CREDIBILITY = Object.freeze({ lead: 0, located: 1, documented: 2, characterized: 2, confirmed: 3, tagged: 2, captured: 4 });

/** Diagnostic value D of each evidence family (how much a record of that kind can identify a species). */
export const FAMILY_D = Object.freeze({ photo: 0.9, trace: 0.7, sample: 0.8, audio: 0.6, behaviour: 0.5, sign: 0.4 });
export const CONFIRM = Object.freeze({ events: 2, families: 2, score: 90, eventCap: 70 });

/** Grade 0-4 of a photo from its score (until evidence grades, #99, give records a grade). */
export function photoGrade(score) { return score >= 85 ? 4 : score >= 65 ? 3 : score >= 40 ? 2 : score >= 15 ? 1 : 0; }
export const GRADE_NAMES = ['unusable', 'ambiguous', 'suggestive', 'compelling', 'exceptional'];

export function emptySpecies(id, name) {
  return { id, name, milestones: { lead: 'witness report' }, signs: [], records: [], findings: [] };
}

export function emptyResearch() { return { credibility: 0, awarded: [], species: {} }; }

/**
 * Add one extracted attempt's field results to the dossier and award any new milestones.
 * attempt: { id, extracted, species: { id, name }, signs: [{ id, verified, compatible }],
 *   records: [{ id, family, grade, target, verified }], findings: [{ id, behaviour, verified }] }
 * Returns { research, newly: [{ species, milestone, credibility }], ignored: [why] }.
 */
export function addAttempt(research, attempt) {
  const r = research ?? emptyResearch();
  const ignored = [];
  const newly = [];
  if (!attempt?.extracted) { ignored.push('not extracted: field notes are lost'); return { research: r, newly, ignored }; }
  const sp = (r.species[attempt.species.id] ??= emptySpecies(attempt.species.id, attempt.species.name));
  const ev = attempt.id;
  for (const s of attempt.signs ?? []) sp.signs.push({ ...s, event: `${ev}:${s.id}` });
  for (const rec of attempt.records ?? []) {
    const accepted = rec.target && rec.verified !== false && rec.grade >= 1;
    if (!accepted || rec.grade < 2) ignored.push(`${rec.family} record grade ${rec.grade} (${GRADE_NAMES[rec.grade] ?? '?'})${rec.target ? '' : ', not clearly the target'}: ambiguous, no milestone`);
    sp.records.push({ ...rec, event: ev, accepted });
  }
  for (const f of attempt.findings ?? []) sp.findings.push({ ...f, event: `${ev}:${f.behaviour}` });
  for (const m of evaluate(sp)) {
    if (sp.milestones[m]) continue;
    sp.milestones[m] = ev;
    const key = `${sp.id}:${m}`;
    if (!r.awarded.includes(key)) { r.awarded.push(key); r.credibility += CREDIBILITY[m]; newly.push({ species: sp.name, milestone: m, credibility: CREDIBILITY[m] }); }
  }
  return { research: r, newly, ignored };
}

/** Which milestones a species' dossier meets now (deterministic; can be earned out of order). */
export function evaluate(sp) {
  const met = [];
  const verifiedSigns = sp.signs.filter((s) => s.verified);
  const ambiguousEvents = new Set(sp.signs.filter((s) => !s.verified && s.compatible).map((s) => s.event));
  if (verifiedSigns.length >= 1 || ambiguousEvents.size >= 2) met.push('located');
  const accepted = sp.records.filter((x) => x.accepted);
  if (accepted.some((x) => x.grade >= 2)) met.push('documented');
  const behaviours = new Set(sp.findings.filter((f) => f.verified).map((f) => f.behaviour));
  if (behaviours.size >= 2) met.push('characterized');
  const c = confidence(sp);
  if (c.events >= CONFIRM.events && c.families >= CONFIRM.families && c.score >= CONFIRM.score) met.push('confirmed');
  return met;
}

/** Confidence score: per event, its best accepted record's Q x D (x100), at most 70; summed. */
export function confidence(sp) {
  const best = new Map(), families = new Set();
  for (const x of sp.records) {
    if (!x.accepted || x.grade < 2) continue;
    const v = Math.min(CONFIRM.eventCap, (x.grade / 4) * (FAMILY_D[x.family] ?? 0.5) * 100);
    best.set(x.event, Math.max(best.get(x.event) ?? 0, v));
    families.add(x.family);
  }
  const score = [...best.values()].reduce((a, b) => a + b, 0);
  return { score, display: Math.min(100, Math.round(score)), events: best.size, families: families.size };
}

/** Buyer tiers (7.2): earliest expedition and minimum career credibility. Enthusiasts always open. */
export const BUYERS = [
  { id: 'enthusiasts', name: 'Local enthusiasts', level: 1, credibility: 0, focus: 'local traces and photos' },
  { id: 'folklore', name: 'Folklore publishers', level: 2, credibility: 0, focus: 'local documentation' },
  { id: 'foundation', name: 'Research foundations', level: 4, credibility: 6, focus: 'samples and corroboration' },
  { id: 'documentary', name: 'Documentary producers', level: 6, credibility: 10, focus: 'footage and behaviour' },
  { id: 'sponsor', name: 'Private sponsors', level: 9, credibility: 18, focus: 'telemetry and specialist evidence' },
  { id: 'specimen', name: 'Specimen clients', level: 10, credibility: 21, focus: 'living delivery' },
];
export function buyersFor({ level, credibility }) {
  return BUYERS.map((b) => ({ ...b, open: b.id === 'enthusiasts' || (level >= b.level && credibility >= b.credibility) }));
}

/**
 * Next-destination unlock (6.4): a successful extraction from the previous destination, plus its
 * target's Documented milestone, plus being able to afford the trip.
 * choice: { id, level, after: { map, species } , tripCents }. state: { research, hunts, moneyCents }.
 */
export function unlockStatus(choice, { research, extractedFrom = [], moneyCents = 0 }) {
  if (!choice.after) return { open: true, reasons: [] };
  const sp = research?.species?.[choice.after.species];
  const reasons = [];
  if (!extractedFrom.includes(choice.after.map)) reasons.push(`a successful extraction from ${choice.after.mapName}`);
  if (!sp?.milestones?.documented) reasons.push(`${choice.after.speciesName} Documented`);
  if (moneyCents < (choice.tripCents ?? 0)) reasons.push(`$${((choice.tripCents ?? 0) / 100).toFixed(0)} for the trip`);
  return { open: reasons.length === 0, reasons };
}

/** One line per species: milestones reached (✓) and still open (·). */
export function dossierLine(sp) {
  const core = ['lead', 'located', 'documented', 'characterized', 'confirmed'];
  return `${sp.name} dossier: ` + core.map((m) => `${sp.milestones[m] ? '✓' : '·'} ${MILESTONE_NAMES[m]}`).join('  ');
}

/** Debrief lines for one settled attempt's research result. */
export function researchLines(res) {
  if (!res) return [];
  const out = res.newly.map((n) => `  Research: ${n.species} ${MILESTONE_NAMES[n.milestone]} (+${n.credibility} credibility)`);
  if (!res.newly.length) out.push(`  Research: no new milestone${res.ignored.length ? ` (${res.ignored[0]})` : ''}`);
  out.push(`  Career credibility: ${res.credibility}`);
  return out;
}

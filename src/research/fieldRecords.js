// Turn one attempt's field results into dossier input (#101): what the player examined, shot,
// bagged and witnessed, judged for the night's target species.
//   signs     examined clues. A clue type that strongly points at the target (e.g. a huge bare
//             footprint for Bigfoot: likely for it, unlikely for anything else) is a verified
//             target-associated sign; one merely compatible with it is ambiguous. Deer tracks say nothing.
//   records   photos (grade from #99's grade if present, else from the score) and extracted
//             physical evidence (footprint photos, samples), each tagged with its evidence family.
//   findings  behaviour observed this attempt: a knock exchange, a warning (whoop / thrown rock),
//             a charge or roar, feeding at bait.
import { CANDIDATES, clueFeature } from '../journal/clueEvidence.js';
import { photoGrade } from './dossier.js';

export const SPECIES = { Bigfoot: 'bigfoot', Mothman: 'mothman', Chupacabra: 'chupacabra' };

export function judgeSign(clue, speciesId) {
  if (clue.type === 'deerTrack' || clue.type === 'foxTrack' || clue.type === 'owlFeather') return null;
  const f = clueFeature(clue);
  const me = CANDIDATES.find((c) => c.id === speciesId);
  if (!me) return null;
  const mine = me.likelihood[f] ?? 0.01;
  const other = Math.max(...CANDIDATES.filter((c) => c.id !== speciesId).map((c) => c.likelihood[f] ?? 0.01));
  return { id: `clue${clue.id ?? f}`, feature: f, verified: mine >= 0.2 && mine >= other * 3, compatible: mine >= 0.05 };
}

const FAMILY_OF = (type) => (/sample|pouch|hair|scat/i.test(type) ? 'sample' : 'trace');

export function fieldRecords({ target, journalEntries = [], photos = [], evidence = [], knocks = [], events = [] }) {
  const speciesId = SPECIES[target] ?? String(target).toLowerCase();
  const signs = journalEntries.map((e) => judgeSign({ ...e.clue, id: e.clueId }, speciesId)).filter(Boolean);
  const records = [
    ...photos.map((p, i) => ({ id: `photo${i}`, family: 'photo', grade: p.grade ?? photoGrade(p.score ?? 0), target: p.subject === target, verified: true, score: p.score })),
    ...evidence.map((x) => ({ id: `ev${x.id}`, family: FAMILY_OF(x.type), grade: x.grade ?? 2, target: (x.cryptid ?? '').toLowerCase() === speciesId || x.cryptid === target, verified: true })),
  ];
  const seen = new Set(), findings = [];
  const add = (behaviour) => { if (!seen.has(behaviour)) { seen.add(behaviour); findings.push({ id: behaviour, behaviour, verified: true }); } };
  for (const k of knocks) if (k.who === target) add('knock');
  for (const e of events) {
    if (e.name && e.name !== target) continue;
    if (e.type === 'whoop' || e.type === 'rock') add('warning');
    if (e.type === 'roar' || e.type === 'charge') add('charge');
    if (e.type === 'fed') add('feeding');
  }
  return { species: { id: speciesId, name: target }, signs, records, findings };
}

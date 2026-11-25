// What each clue says about which cryptid left it.
// A found clue is reduced to an evidence "feature" (e.g. a footprint is 'large' or 'small'),
// and each candidate cryptid has a likelihood of leaving that feature. The journal combines
// found clues with Bayes' rule into a confidence per cryptid.

/** Turn a found clue into a feature key like 'footprint:large'. */
export function clueFeature(clue) {
  switch (clue.type) {
    case 'footprint': return (clue.data?.length ?? 0) >= 0.38 ? 'footprint:large' : 'footprint:small';
    case 'scratch': return clue.y >= 1.5 ? 'scratch:high' : 'scratch:low';
    case 'hair': return 'hair';
    default: return clue.type;
  }
}

/** Player-facing description of a clue for the journal. */
export function describeClue(clue) {
  switch (clue.type) {
    case 'footprint': {
      const cm = Math.round((clue.data?.length ?? 0) * 100);
      return `${cm >= 38 ? 'Huge' : 'Small'} bare footprint, ${cm} cm long`;
    }
    case 'scratch': return `Claw marks gouged ${clue.y.toFixed(1)} m up`;
    case 'hair': return 'Tuft of coarse brown hair';
    default: return clue.type;
  }
}

// Likelihood of finding each feature if that cryptid made the trail. Only relative values matter.
// Cryptids that don't leave clues in game yet are still candidates, so evidence has to rule them out.
export const CANDIDATES = [
  {
    id: 'bigfoot', name: 'Bigfoot',
    likelihood: { 'footprint:large': 0.45, 'footprint:small': 0.02, hair: 0.3, 'scratch:high': 0.2, 'scratch:low': 0.03 },
  },
  {
    id: 'chupacabra', name: 'Chupacabra',
    likelihood: { 'footprint:large': 0.03, 'footprint:small': 0.45, hair: 0.15, 'scratch:high': 0.02, 'scratch:low': 0.35 },
  },
  {
    id: 'mothman', name: 'Mothman',
    likelihood: { 'footprint:large': 0.05, 'footprint:small': 0.05, hair: 0.1, 'scratch:high': 0.2, 'scratch:low': 0.05 },
  },
];

export const CLUES_FOR_VERDICT = 3;

/** Confidence per candidate (sums to 1), highest first. Uniform before any evidence. */
export function assess(foundClues) {
  const scores = CANDIDATES.map((c) => {
    let logL = 0;
    for (const clue of foundClues) logL += Math.log(c.likelihood[clueFeature(clue)] ?? 0.01);
    return { id: c.id, name: c.name, logL };
  });
  const max = Math.max(...scores.map((s) => s.logL));
  const total = scores.reduce((a, s) => a + Math.exp(s.logL - max), 0);
  return scores
    .map((s) => ({ id: s.id, name: s.name, confidence: Math.exp(s.logL - max) / total }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function confidenceWord(p) {
  return p >= 0.85 ? 'High' : p >= 0.6 ? 'Medium' : 'Low';
}

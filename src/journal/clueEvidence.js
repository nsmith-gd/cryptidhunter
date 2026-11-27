// What each clue says about which cryptid left it.
// A found clue is reduced to an evidence "feature" (e.g. a footprint is 'large' or 'small'),
// and each candidate cryptid has a likelihood of leaving that feature. The journal combines
// found clues with Bayes' rule into a confidence per cryptid.

/** Ordinary-animal sign types (GDD 4.4 false leads, #99). */
export const ORDINARY_SIGN = new Set(['deerTrack', 'foxTrack', 'owlFeather']);

/** Turn a found clue into a feature key like 'footprint:large'. */
export function clueFeature(clue) {
  switch (clue.type) {
    case 'footprint': return clue.data?.uneven ? 'footprint:lopsided' : (clue.data?.length ?? 0) >= 0.38 ? 'footprint:large' : 'footprint:small';
    case 'scratch': return clue.y >= 1.5 ? 'scratch:high' : 'scratch:low';
    case 'hair': return 'hair';
    case 'branch': return clue.y >= 2 ? 'branch:high' : 'branch:low';
    case 'scat': return (clue.data?.size ?? 1) >= 1.3 ? 'scat:large' : 'scat:small';
    default: return clue.type;
  }
}

/** Player-facing description of a clue for the journal. */
export function describeClue(clue) {
  switch (clue.type) {
    case 'footprint': {
      const cm = Math.round((clue.data?.length ?? 0) * 100);
      // The Sidehill Gouger's lopsided gait (#130): pairs of small prints, one side shorter.
      if (clue.data?.uneven) return `Small cloven prints in pairs, one side shorter (${cm} cm${clue.data.short ? ' here' : ''}): something walking across the slope, same side uphill`;
      return `${cm >= 38 ? 'Huge' : 'Small'} bare footprint, ${cm} cm long`;
    }
    case 'scratch': return `Claw marks gouged ${clue.y.toFixed(1)} m up`;
    case 'hair': return 'Tuft of coarse brown hair';
    case 'branch': return `Branch snapped off ${clue.y.toFixed(1)} m up: something tall pushed through`;
    case 'scat': return `${(clue.data?.size ?? 1) >= 1.3 ? 'Large' : 'Small'} pile of droppings, still soft`;
    case 'deerTrack': return 'Small split-hoof prints in pairs, 7 cm long';
    case 'foxTrack': return 'Small four-toed paw prints in a neat single line, 5 cm long';
    case 'owlFeather': return 'A soft feather, barred brown and cream, a hand long';
    case 'shoreTrace': return 'Reeds pressed flat in a wide swathe toward the water, slick with slime';
    case 'wingDust': return 'Fine grey scales smeared on the boards, glittering like moth-wing dust';
    default: return clue.type;
  }
}

// Likelihood of finding each feature if that cryptid made the trail. Only relative values matter.
// Cryptids that don't leave clues in game yet are still candidates, so evidence has to rule them out.
export const CANDIDATES = [
  {
    id: 'bigfoot', name: 'Bigfoot',
    likelihood: { 'footprint:lopsided': 0.01, 'footprint:large': 0.45, 'footprint:small': 0.02, hair: 0.3, 'scratch:high': 0.2, 'scratch:low': 0.03, 'branch:high': 0.25, 'branch:low': 0.05, 'scat:large': 0.15, 'scat:small': 0.02, wingDust: 0.01 },
  },
  {
    id: 'chupacabra', name: 'Chupacabra',
    likelihood: { 'footprint:lopsided': 0.02, 'footprint:large': 0.03, 'footprint:small': 0.45, hair: 0.15, 'scratch:high': 0.02, 'scratch:low': 0.35, 'branch:high': 0.02, 'branch:low': 0.1, 'scat:large': 0.03, 'scat:small': 0.2, wingDust: 0.01 },
  },
  {
    id: 'mothman', name: 'Mothman',
    likelihood: { 'footprint:lopsided': 0.01, 'footprint:large': 0.05, 'footprint:small': 0.05, hair: 0.1, 'scratch:high': 0.2, 'scratch:low': 0.05, 'branch:high': 0.12, 'branch:low': 0.05, 'scat:large': 0.03, 'scat:small': 0.05, wingDust: 0.6 },
  },
  {
    id: 'gouger', name: 'Sidehill Gouger',   // Level 2 (#130): lopsided hillside prints and light hair
    likelihood: { 'footprint:lopsided': 0.6, 'footprint:large': 0.01, 'footprint:small': 0.05, hair: 0.25, 'scratch:high': 0.01, 'scratch:low': 0.02, 'branch:high': 0.01, 'branch:low': 0.03, 'scat:large': 0.02, 'scat:small': 0.1, wingDust: 0.01 },
  },
];

export const CLUES_FOR_VERDICT = 3;

/** Confidence per candidate (sums to 1), highest first. Uniform before any evidence. */
export function assess(foundClues) {
  const scores = CANDIDATES.map((c) => {
    let logL = 0;
    for (const clue of foundClues) {
      if (ORDINARY_SIGN.has(clue.type)) continue;   // an ordinary animal says nothing about which cryptid (GDD 4.4)
      logL += Math.log(c.likelihood[clueFeature(clue)] ?? 0.01);
    }
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

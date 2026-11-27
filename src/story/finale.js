// The final commitment and the canonical disappearance (#156; GDD §9.1, §11.2). Pure: no DOM.
//
// At the final site the player is asked, explicitly, whether to go further: contact may be
// irreversible. Until they confirm, everything is an ordinary trip: leaving is an ordinary
// extraction, dying is an ordinary (retryable) death. After they confirm, reaching the last
// extraction approach ends in the authored encounter: the canonical disappearance. That is
// recorded on the career as narrative completion - not a death, and no payout.

export const COMMITMENT = Object.freeze({
  title: 'Past this point there may be no coming back',
  body: [
    'Whatever is out here has been waiting a long time. If you go further, you may not return.',
    'You can still turn back now: leave by the trailhead and the case stays open. You can come back another time.',
    'Going on cannot be undone.',
  ],
  confirm: 'Go on',
  cancel: 'Turn back',
});

/** The career's finale record, created on first use (a plain object kept in the save). */
export function finaleRecord(state) {
  state.finale ??= { committed: false, disappeared: null, attempts: [], ordinaryDeaths: 0, extractions: 0, caseComplete: false };
  return state.finale;
}

/** The player confirmed the irreversible step. */
export function recordCommitment(state, { attemptId = null, at = 0 } = {}) {
  const f = finaleRecord(state);
  f.committed = true;
  f.attempts.push({ attemptId, event: 'committed', at });
  return f;
}

/**
 * How a finale attempt ended. kind: 'extracted' | 'died' | 'disappeared'.
 *   extracted    ordinary extraction (before any commitment): the case stays open
 *   died         an ordinary death: retryable, the case stays open, counted as a death
 *   disappeared  only after the commitment: narrative completion, not a death, no final payout
 */
export function recordFinaleOutcome(state, { kind, attemptId = null, at = 0 }) {
  const f = finaleRecord(state);
  if (kind === 'disappeared' && !f.committed) throw new Error('a disappearance needs the final commitment first');
  f.attempts.push({ attemptId, event: kind, at });
  if (kind === 'extracted') f.extractions++;
  if (kind === 'died') f.ordinaryDeaths++;
  if (kind === 'disappeared') { f.disappeared = { attemptId, at, payout: 0 }; f.caseComplete = true; }
  if (kind !== 'disappeared') f.committed = false;   // a new trip asks again
  return f;
}

/** Is the career's story finished (the disappearance happened)? Ordinary deaths never finish it. */
export const careerFinished = (state) => !!state.finale?.disappeared;

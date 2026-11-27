// Tagging (#148, GDD 8.2): the research track for a tagged creature, separate from capture.
//   Untracked -> Tagged -> Interval recorded (valid telemetry interval) -> Recovered
// Pure and deterministic: no DOM, no clock, no randomness; the caller passes the time.
//
//   tag        only during an opportunity window, with a compatible tag. Tagged is not captured:
//              the creature stays free (its AI owns where it goes).
//   telemetry  receiver fixes. A fix counts when it's in receiver range with enough signal, at least
//              `minSpacing` s after the last counted fix (distinct updates, not one ping repeated).
//              Three counted fixes inside one sustained observation (no gap over `maxGap` s) make one
//              valid telemetry interval. A longer gap breaks the run: it is recorded (gaps are visible)
//              and the run starts again.
//   recover    the records are yours only if you extract with them. Unextracted: lost, nothing pays.
//              Only valid recovered intervals pay (GDD 8.2 "only valid recovered records pay").

export const TAGGING = Object.freeze({
  updatesPerInterval: 3,
  minSpacing: 10,       // s between counted fixes
  maxGap: 60,           // s: longer without a counted fix breaks the observation
  minSignal: 0.2,       // 0..1 signal strength a fix needs
});

export const TAG_STATES = Object.freeze(['Untracked', 'Tagged', 'IntervalRecorded', 'Recovered']);

export class TagTrack {
  constructor({ tagId = 'F16-1', subjectId = 'jersey-devil', cfg = {} } = {}) {
    this.cfg = { ...TAGGING, ...cfg };
    this.tagId = tagId;
    this.subjectId = subjectId;
    this.state = 'Untracked';
    this.taggedAt = null;
    this.fixes = [];        // every fix offered: { t, inRange, signal, counted, why }
    this.run = [];          // counted fixes in the current observation
    this.intervals = [];    // valid intervals: { from, to, fixes: [t, t, t] }
    this.gaps = [];         // broken observations: { from, to, seconds }
    this.recovered = null;  // { t, extracted, payable }
  }

  get tagged() { return this.state !== 'Untracked'; }
  get payable() { return !!this.recovered?.extracted && this.intervals.length > 0; }

  /** Fire a tag. opportunity: the creature's tag window is open; compatible: the right tag for it. */
  tag(t, { opportunity = false, compatible = true } = {}) {
    if (this.state !== 'Untracked') return { ok: false, reason: 'already tagged' };
    if (!opportunity) return { ok: false, reason: 'no opportunity window' };
    if (!compatible) return { ok: false, reason: 'incompatible tag' };
    this.state = 'Tagged';
    this.taggedAt = t;
    return { ok: true, state: this.state };
  }

  /** A receiver fix at time t. Returns whether it counted and the state after. */
  telemetry(t, { inRange = false, signal = 0 } = {}) {
    const c = this.cfg;
    const rec = (counted, why) => { this.fixes.push({ t, inRange, signal, counted, why }); return { counted, why, state: this.state, run: this.run.length, intervals: this.intervals.length }; };
    if (this.state === 'Untracked') return rec(false, 'not tagged');
    if (this.state === 'Recovered') return rec(false, 'already recovered');
    const last = this.run[this.run.length - 1] ?? null;
    // A long silence breaks the observation (whether or not this fix is good).
    if (last != null && t - last > c.maxGap) { this.gaps.push({ from: last, to: t, seconds: t - last }); this.run = []; }
    if (!inRange) return rec(false, 'out of receiver range');
    if (signal < c.minSignal) return rec(false, 'signal too weak');
    const prev = this.run[this.run.length - 1];
    if (prev != null && t - prev < c.minSpacing) return rec(false, 'too soon after the last fix');
    this.run.push(t);
    if (this.run.length >= c.updatesPerInterval) {
      this.intervals.push({ from: this.run[0], to: t, fixes: [...this.run] });
      this.run = [];
      this.state = 'IntervalRecorded';
      return rec(true, 'interval recorded');
    }
    return rec(true, 'fix');
  }

  /** Bring the records home. extracted=false (caught, abandoned): they're lost. */
  recover(t, { extracted = false } = {}) {
    if (this.state === 'Untracked') return { ok: false, reason: 'nothing to recover' };
    if (this.recovered) return { ok: true, duplicate: true, ...this.recovered };
    this.recovered = { t, extracted, payable: extracted && this.intervals.length > 0, intervals: extracted ? this.intervals.length : 0 };
    if (extracted) this.state = 'Recovered';
    return { ok: extracted, ...this.recovered };
  }

  toJSON() { return { tagId: this.tagId, subjectId: this.subjectId, state: this.state, taggedAt: this.taggedAt, fixes: this.fixes, run: this.run, intervals: this.intervals, gaps: this.gaps, recovered: this.recovered }; }
  static fromJSON(o) { const t = new TagTrack({ tagId: o.tagId, subjectId: o.subjectId }); Object.assign(t, { state: o.state, taggedAt: o.taggedAt, fixes: o.fixes ?? [], run: o.run ?? [], intervals: o.intervals ?? [], gaps: o.gaps ?? [], recovered: o.recovered ?? null }); return t; }
}

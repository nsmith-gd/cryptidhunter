import { OK, RUN, FAIL } from './bt.js';

// Shared data-driven behaviour (GDD 5.2-5.3, #86). Any species without signature rules runs on
// this: its profile supplies TRAITS (hidden, 0..1) and the ACTIONS its species adapter enables,
// and every tick the brain scores each eligible action:
//   score = weighted need + stimulus confidence + species priority - risk - switching cost
// It keeps the current action until a rival beats it by the hysteresis margin, after a minimum
// commitment; an urgent safety interrupt (something frightening right on top of it) skips both.
//
// Action library (shared): roam, feed, investigate (last-known cue), observe, flee, warn, pursue,
// return (disengage home). A species lists the ones it may use in profile.actions.

export const DEFAULT_TRAITS = Object.freeze({
  alertness: 0.5,      // how quickly a faint cue makes it suspicious (scales investigate need)
  fear: 0.6,           // avoidance / retreat propensity
  curiosity: 0.5,      // investigation priority for unfamiliar cues
  aggression: 0.1,     // confrontation threshold
  territoriality: 0,   // attachment to its home range (warns / returns)
  habituation: 0.25,   // per fruitless check of the same kind of cue, how much less it cares (bounded)
});

export const UTILITY = Object.freeze({
  hysteresis: 0.12,    // a rival must beat the current action's score by this much
  minCommit: 1.5,      // seconds before a voluntary switch
  urgentDistance: 4,   // metres: a detected player this close interrupts anything (fear permitting)
  habituationCap: 0.8,
});

/** Traits for a profile: explicit ones, else derived from its older behaviour block. */
export function traitsFor(profile) {
  const b = profile.behavior ?? {};
  const derived = b.onDetect === 'aggress' ? { fear: 0.1, aggression: 0.9 } : {};
  return { ...DEFAULT_TRAITS, ...derived, ...(profile.traits ?? {}) };
}

const DEFAULT_ACTIONS = ['roam', 'feed', 'investigate', 'observe', 'flee', 'pursue', 'return'];

export function utilityBrain(c) {
  const T = traitsFor(c.profile);
  const enabled = new Set(c.profile.actions ?? DEFAULT_ACTIONS);
  const pc = () => c.perception;
  const B = () => c.profile.behavior;
  const habit = new Map();    // cue class -> fruitless checks (habituation, bounded)
  const hab = (k) => Math.min(UTILITY.habituationCap, (habit.get(k) ?? 0) * T.habituation);
  const lureNear = () => {
    if (!c.lureSource) return null;
    let best = null, bestD = c.profile.lureRange;
    for (const l of c.lureSource.lures()) {
      if (l.gone || (l.claimedBy && l.claimedBy !== c) || c.unreachable.has(l)) continue;
      const d = Math.hypot(l.x - c.agent.x, l.z - c.agent.z);
      if (d < bestD) { best = l; bestD = d; }
    }
    return best ? { lure: best, d: bestD } : null;
  };
  const cue = () => {     // the strongest unexplained cue it remembers (not the player in plain view)
    const m = pc().recall({ source: 'player' }) ?? pc().recall();
    if (!m || m.confidence < 0.15) return null;
    return m;
  };
  const awayFromHome = () => Math.hypot(c.agent.x - c.home0.x, c.agent.z - c.home0.z);
  c.home0 ??= { ...c.home };      // where its range is centred (roaming re-homes, territory doesn't)

  // Each action: eligible(), score(), start(), tick() -> RUN | OK (done).
  const A = {
    roam: {
      score: () => 0.2,
      start: () => { if (c.state !== 'roam') c.enterRoam(c.lastWhy === 'back home' ? 'back home' : 'nothing going on'); },
      tick: () => { c.tickRoam(c.dt); return RUN; },
    },
    feed: {
      eligible: () => !!lureNear() || !!c.lure,
      score: () => 0.45 + 0.25 * (1 - T.fear) - (pc().detected ? 0.4 : 0),
      start: () => { if (!c.lure) c.findLure(); },
      tick: () => { if (!c.lure) return OK; c.tickInvestigate(c.dt); return c.lure ? RUN : OK; },
    },
    investigate: {
      eligible: () => !pc().detected && !!cue(),
      score: () => {
        const m = cue();
        if (!m) return 0.3;          // still walking to a cue it has since forgotten: finish the look
        return T.curiosity * (0.3 + 0.7 * m.confidence) * (0.6 + T.alertness * 0.8) + 0.1 * Math.min(1, m.intensity * 3)
          - T.fear * 0.15 - hab(m.channel);
      },
      start: () => {
        const m = cue();
        if (!m) return;
        c.investigating = m;
        c.enterInvestigateNoise({ x: m.x, z: m.z }, c.stage === 'lost' ? 'checking where it lost you' : `${m.channel === 'acoustic' ? 'heard' : 'sensed'} something`);
        c.lookLeft = B().lookAround;
      },
      tick: () => {
        if (c.state !== 'investigate') {   // reached it and found nothing: that kind of cue matters less now
          const k = c.investigating?.channel; if (k) habit.set(k, (habit.get(k) ?? 0) + 1);
          if (c.investigating) c.investigating.confidence = 0;
          const m = c.investigating; if (m) pc().memory = pc().memory.filter((r) => r !== m);
          c.investigating = null;
          return OK;
        }
        c.tickInvestigate(c.dt);
        return RUN;
      },
    },
    observe: {
      eligible: () => pc().seen && pc().awareness >= B().observeAt && c.observeCooldown <= 0 && !pc().detected,
      score: () => T.curiosity * 0.7 + pc().awareness * 0.3 - T.fear * 0.25 + 0.15,
      start: () => c.enterObserve('glimpsed something'),
      tick: () => { if (c.state !== 'observe') return OK; c.tickObserve(c.dt, c.p); return c.state === 'observe' ? RUN : OK; },
    },
    flee: {
      eligible: () => pc().detected || (c.state === 'flee' && (c.playerDistance < c.profile.fleeSafeDistance || pc().detected)),
      score: () => T.fear * (0.6 + 0.4 * pc().awareness) + (c.playerDistance < 10 ? 0.25 : 0) - T.aggression * 0.3 + (c.state === 'flee' ? 0.2 : 0),
      start: () => { c.flees++; c.enterFlee(c.p, 'detected you'); },
      tick: () => {
        if (c.playerDistance > c.profile.fleeSafeDistance && !pc().detected) { c.enterRoam('lost you'); return OK; }
        c.tickFlee(c.dt, c.p); return RUN;
      },
    },
    warn: {
      eligible: () => pc().detected && T.territoriality > 0 && awayFromHome() < c.profile.roamRadius && c.clock - (c.lastWarn ?? -99) > 20,
      score: () => T.territoriality * 0.8 + T.aggression * 0.2,
      start: () => { c.lastWarn = c.clock; c.releaseLure(); c.agent.stop(); c.setState('warn', 'you are in its territory'); c.emit('warn', { x: c.agent.x, z: c.agent.z }); },
      tick: () => { c.faceToward(c.p.x, c.p.z, c.dt, 4); return c.stateTime < 2.5 ? RUN : OK; },
    },
    pursue: {
      eligible: () => pc().detected || c.state === 'aggress',
      score: () => {
        if (c.state === 'aggress') return 2;   // committed until tickAggress gives up
        const b = B();
        const cornered = b.turnWithin > 0 && c.playerDistance <= b.turnWithin ? 0.6 : 0;
        const fedUp = b.turnAfterFlees > 0 && c.flees >= b.turnAfterFlees ? 0.6 : 0;
        const turf = T.territoriality * (awayFromHome() < c.profile.roamRadius ? 0.25 : 0) * ((c.lastWarn ?? -99) > -99 ? 1 : 0);
        return T.aggression * (0.5 + 0.5 * pc().awareness) + cornered + fedUp + turf;
      },
      start: () => c.enterAggress(c.playerDistance <= (B().turnWithin || -1) ? 'cornered' : 'detected you'),
      tick: () => { if (c.state !== 'aggress') return OK; c.tickAggress(c.dt, c.p); return c.state === 'aggress' ? RUN : OK; },
    },
    return: {
      eligible: () => awayFromHome() > c.profile.roamRadius * (T.territoriality > 0 ? 1.3 : 1.8) && !pc().detected,
      score: () => 0.3 + T.territoriality * 0.4,
      start: () => {
        c.releaseLure();
        c.setState('return', 'heading back to its range');
        c.agent.speed = c.profile.roamSpeed * 1.2;
        const s = c.agent.grid.sample(c.home0.x, c.home0.z, 4);
        if (s) c.agent.setDestination(s.x, s.z);
      },
      tick: () => {
        if (!c.agent.hasPath || awayFromHome() < 3) { c.home = { ...c.home0 }; c.enterRoam('back home'); return OK; }
        return RUN;
      },
    },
  };

  let current = null, since = 0;
  const scores = {};
  const brain = {
    path: [], scores,
    get pathText() { return this.path.join(' › '); },
    get current() { return current; },
    tick() {
      since += c.dt;
      for (const k of Object.keys(scores)) delete scores[k];
      let best = null, bestS = -Infinity;
      for (const [id, a] of Object.entries(A)) {
        // The action under way stays in the running until it finishes, even if what started it has passed.
        if (!enabled.has(id) || (id !== current && a.eligible && !a.eligible())) continue;
        const s = a.score();
        scores[id] = +s.toFixed(2);
        if (s > bestS) { best = id; bestS = s; }
      }
      const curS = current != null ? scores[current] : undefined;
      // Urgent safety interrupt: detected and close, and it's the fearful kind.
      const urgent = pc().detected && c.playerDistance < UTILITY.urgentDistance && T.fear > T.aggression && enabled.has('flee') && current !== 'flee';
      const voluntary = curS === undefined || since >= UTILITY.minCommit;
      if (best && best !== current && (urgent || curS === undefined || (voluntary && bestS > curS + UTILITY.hysteresis))) {
        if (urgent) best = 'flee';
        current = best; since = 0;
        A[current].start();
      }
      if (current) {
        const r = A[current].tick();
        if (r === OK) { current = null; since = 0; }
      }
      this.path = [c.profile.name, current ?? 'idle', ...(urgent ? ['urgent'] : [])];
      return this.path;
    },
  };
  return brain;
}

export { OK, RUN, FAIL };

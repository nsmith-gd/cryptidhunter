import { sel, seq, when, act, tier, Brain, OK, RUN, FAIL } from './bt.js';

// BIGFOOT (Sasquatch) — behaviour tree, lore first:
//  · A reclusive forest giant that avoids people: it would rather vanish into deep cover than fight.
//  · Curious: it creeps toward strange sounds, stopping to listen; it is drawn to food and to calls.
//  · When it glimpses a person it freezes and stares (the classic sighting), then often SHADOWS
//    them — pacing parallel through the treeline, just out of the light.
//  · Territorial when pushed: it warns first — a whoop and a thrown rock that lands near you —
//    and if you keep pressing or corner it, it charges. A first charge is usually a bluff.
//
// Rules this teaches the player (in order of importance):
//  1. Stay quiet and low: noise brings it to you, but slowly and warily.
//  2. Don't shine your light on it or rush it: every time it spots you it gets more agitated.
//  3. Heed the warning: a whoop and a rock mean "back off". Push again and it charges.
//  4. Never corner it up close. 5. Patience pays: stay still and it may stand and stare, or follow you.
//
// Escalation: each level makes it quicker to anger and more dangerous (see TIERS).
export const BIGFOOT_TIERS = {
  1: { warnAt: 0.6, chargeAt: 0.95, cornerDist: 4, bluffFirst: true, rockMiss: 6.5, shadowChance: 0.6, shadowTime: 22, agitateOnDetect: 0.34, beamAgitation: 0.12, calmRate: 0.012, listenEvery: 5, listenFor: 1.6 },
  2: { warnAt: 0.3, chargeAt: 0.65, cornerDist: 6, bluffFirst: true, rockMiss: 3.5, shadowChance: 0.85, shadowTime: 35, agitateOnDetect: 0.38, beamAgitation: 0.2, calmRate: 0.01, listenEvery: 7, listenFor: 1.1 },
  3: { warnAt: 0.0, chargeAt: 0.6, cornerDist: 8, bluffFirst: false, rockMiss: 0.8, shadowChance: 1.0, shadowTime: 50, agitateOnDetect: 0.45, beamAgitation: 0.3, calmRate: 0.006, listenEvery: 10, listenFor: 0.6 },
};

export function bigfootBrain(c) {
  const T = () => BIGFOOT_TIERS[Math.min(3, Math.max(1, c.level))];
  const pc = () => c.perception;
  const B = () => c.profile.behavior;
  const ctx = { get level() { return c.level; } };

  const root = sel('Bigfoot',
    // --- Already committed to something: see it through. ---------------------------------
    seq('Charging', when('charging', () => c.state === 'aggress'), act('charge home', () => c.tickCharge(c.dt, c.p))),
    seq('Warning you off', when('warning', () => c.state === 'warn'), act('whoop + throw a rock', () => c.tickWarn(c.dt, c.p))),

    // --- Threatened: it has detected you. ------------------------------------------------
    seq('Threatened', when('detected', () => c.noticesPlayer() && c.state !== 'flee'),
      act('agitated', () => { c.agitate(T().agitateOnDetect, 'spotted you'); return OK; }),
      sel('React',
        seq('Cornered', when('too close', () => c.playerDistance <= T().cornerDist),
          act('charge (cornered)', () => c.startCharge({ bluff: T().bluffFirst && !c.bluffed, why: 'cornered' }))),
        // It always warns before a deliberate charge (cornering it is the exception).
        seq('Fed up', when('agitation high, already warned you', () => c.agitation >= T().chargeAt && c.lastWarn > -99),
          act('charge (fed up)', () => c.startCharge({ bluff: false, why: 'fed up with you' }))),
        seq('Warn off', when('agitated, not warned lately', () => c.agitation >= T().warnAt && (c.lastWarn <= -99 || c.clock - c.lastWarn > 25)),
          act('stand tall, whoop, throw a rock', () => c.startWarn(T().rockMiss))),
        act('bolt for deep cover', () => { c.flees++; c.enterFlee(c.p, 'detected you'); return RUN; }))),
    seq('Fleeing', when('fleeing', () => c.state === 'flee'),
      act('run until safe', () => {
        if (c.playerDistance > c.profile.fleeSafeDistance && !pc().detected) { c.enterRoam('lost you'); return OK; }
        c.tickFlee(c.dt, c.p); return RUN;
      })),

    // Your light on it is an affront even before it's sure it's you.
    act('irritated by your light', () => { if (pc().beamLevel > 0) c.agitate(T().beamAgitation * c.dt, null); return FAIL; }),

    // --- Curious: something's out there. -----------------------------------------------------
    seq('Glimpsed you', when('half-seen', () => (c.state === 'roam' || c.state === 'investigate' || c.state === 'shadow')
        && pc().seen && pc().awareness >= B().observeAt && c.observeCooldown <= 0 && c.state !== 'observe'),
      act('freeze and stare', () => { c.enterObserve('glimpsed you'); return RUN; })),
    seq('Staring', when('staring', () => c.state === 'observe'),
      act('stare, then decide', () => {
        const r = c.tickObserve(c.dt, c.p);
        // Lost interest but you're still around and not pressing it: shadow you instead.
        if (c.state === 'roam' && c.playerDistance < 45 && c.rand() < T().shadowChance) c.enterShadow(T().shadowTime);
        return r ?? RUN;
      })),
    seq('Shadowing', when('shadowing', () => c.state === 'shadow'),
      act('pace you from the treeline', () => c.tickShadow(c.dt, c.p))),

    seq('Heard a call', when('call', () => (c.pendingCall = c.state === 'investigate' && c.lure ? null : c.hearCall())),
      act('answer the call', () => {
        if (c.state === 'investigate') { c.retargetNoise(c.pendingCall); c.lookLeft = B().lookAround; }
        else c.enterInvestigateNoise(c.pendingCall, 'heard a call');
        c.cautious = null; return RUN;
      })),
    seq('Heard a noise', when('noise', () => (c.state === 'roam' || (c.state === 'investigate' && !c.lure))
        && pc().heard && pc().hearLevel >= B().investigateHear && pc().lastHeard),
      act('creep toward the sound', () => {
        if (c.state === 'investigate') c.retargetNoise(pc().lastHeard);
        else c.enterInvestigateNoise(pc().lastHeard, 'heard a noise');
        c.cautious ??= { every: T().listenEvery, pause: T().listenFor };
        return RUN;
      })),
    seq('Investigating', when('investigating', () => c.state === 'investigate'),
      act('investigate (stop and listen)', () => { c.tickInvestigate(c.dt); return RUN; })),
    seq('Smelled food', act('smell food', () => (c.findLure() ? RUN : FAIL))),
    act('forage', () => { c.tickRoam(c.dt); return RUN; }),
  );
  return new Brain(root, ctx);
}

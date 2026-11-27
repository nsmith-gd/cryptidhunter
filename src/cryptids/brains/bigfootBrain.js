import { sel, seq, when, act, tier, Brain, OK, RUN, FAIL } from './bt.js';

// BIGFOOT (Sasquatch) — behaviour tree, lore first:
//  · A reclusive forest giant that avoids people: it would rather vanish into deep cover than fight.
//  · Curious: it creeps toward strange sounds, stopping to listen; it is drawn to food and to calls.
//  · When it glimpses a person it freezes and stares (the classic sighting), then often SHADOWS
//    them — pacing parallel through the treeline, just out of the light.
//  · Territorial when pushed: it warns first — a whoop and a thrown rock that lands near you —
//    and if you keep pressing or corner it, it charges. Every charge looks real: a bluff comes at
//    full speed and only pulls up right in your face. Whether it's real is a roll that gets worse
//    for you each level (realCharge), and worse again once it has already warned you.
//
// Rules this teaches the player (in order of importance):
//  1. Stay quiet and low: noise brings it to you, but slowly and warily.
//  2. Don't shine your light on it or rush it: every time it spots you it gets more agitated.
//  3. Heed the warning: a whoop and a rock mean "back off". Push again and it charges.
//  4. Never corner it up close. 5. Patience pays: stay still and it may stand and stare, or follow you.
//
// Escalation: each level makes it quicker to anger and more dangerous (see TIERS).
// Stalking (#115): when it has detected you it no longer just bolts. It keeps you in sight and
// circles at stalkMin..stalkMax metres, closing in while you're quiet and looking away, backing off
// from your light or a rush (see CryptidAI.tickStalk). It only truly flees when you're right on
// top of it (fleeInside) or when you rush it from close range. Higher levels stalk closer and longer.
export const BIGFOOT_TIERS = {
  1: { warnAt: 0.6, chargeAt: 0.95, cornerDist: 4, realCharge: 0.25, rockMiss: 6.5, shadowChance: 0.6, shadowTime: 22, agitateOnDetect: 0.34, beamAgitation: 0.12, calmRate: 0.012, listenEvery: 5, listenFor: 1.6,
    stalkMin: 15, stalkMax: 32, stalkApproach: 0.9, stalkTime: 70, stalkLose: 15, fleeInside: 8 },
  2: { warnAt: 0.3, chargeAt: 0.65, cornerDist: 6, realCharge: 0.5, rockMiss: 3.5, shadowChance: 0.85, shadowTime: 35, agitateOnDetect: 0.38, beamAgitation: 0.2, calmRate: 0.01, listenEvery: 7, listenFor: 1.1,
    stalkMin: 11, stalkMax: 28, stalkApproach: 1.3, stalkTime: 110, stalkLose: 22, fleeInside: 6 },
  3: { warnAt: 0.0, chargeAt: 0.6, cornerDist: 8, realCharge: 0.8, rockMiss: 0.8, shadowChance: 1.0, shadowTime: 50, agitateOnDetect: 0.45, beamAgitation: 0.3, calmRate: 0.006, listenEvery: 10, listenFor: 0.6,
    stalkMin: 8, stalkMax: 24, stalkApproach: 1.8, stalkTime: 160, stalkLose: 30, fleeInside: 4 },
};

export function bigfootBrain(c) {
  const T = () => BIGFOOT_TIERS[Math.min(3, Math.max(1, c.level))];
  const pc = () => c.perception;
  const B = () => c.profile.behavior;
  const ctx = { get level() { return c.level; } };

  const root = sel('Bigfoot',
    // A sighting agitates it once (not every tick it keeps you in view); the latch resets when it loses you.
    act('sighting latch', () => { if (!c.noticesPlayer()) c.detectLatch = false; return FAIL; }),
    // --- Already committed to something: see it through. ---------------------------------
    seq('Charging', when('charging', () => c.state === 'aggress'), act('charge home', () => c.tickCharge(c.dt, c.p))),
    seq('Warning you off', when('warning', () => c.state === 'warn'), act('whoop + throw a rock', () => c.tickWarn(c.dt, c.p))),

    // --- Threatened: it has detected you. ------------------------------------------------
    seq('Threatened', when('detected', () => c.noticesPlayer() && c.state !== 'flee'),
      act('agitated (once per sighting)', () => { if (!c.detectLatch) { c.detectLatch = true; c.agitate(T().agitateOnDetect, 'spotted you'); } return OK; }),
      sel('React',
        seq('Cornered', when('too close', () => c.playerDistance <= T().cornerDist),
          act('charge (cornered)', () => c.startCharge({ bluff: c.rand() >= T().realCharge, why: 'cornered' }))),
        // It always warns before a deliberate charge (cornering it is the exception).
        seq('Fed up', when('agitation high, already warned you', () => c.agitation >= T().chargeAt && c.lastWarn > -99),
          act('charge (fed up)', () => c.startCharge({ bluff: c.rand() >= Math.min(1, T().realCharge + 0.25), why: 'fed up with you' }))),
        seq('Warn off', when('agitated, not warned lately', () => c.agitation >= T().warnAt && (c.lastWarn <= -99 || c.clock - c.lastWarn > 25)),
          act('stand tall, whoop, throw a rock', () => c.startWarn(T().rockMiss))),
        // Right on top of it, or rushed from close range: it breaks and runs for deep cover.
        seq('Too close to hold', when('you are on top of it or rushing it', () => c.playerDistance < T().fleeInside
            || (c.state === 'stalk' && c.stalk?.pressure >= 2 && c.playerDistance < T().fleeInside * 1.8)),
          act('bolt for deep cover', () => { c.flees++; c.enterFlee(c.p, 'too close'); return RUN; })),
        // Otherwise it holds its ground at a distance and stalks you (#115).
        act('stalk you', () => { if (c.state !== 'stalk') c.enterStalk('spotted you', T()); return c.tickStalk(c.dt, c.p, T()); }))),
    // Lost sight of you while stalking: works from where it last saw or heard you, then gives up.
    seq('Stalking', when('stalking', () => c.state === 'stalk'),
      act('circle where it last had you', () => c.tickStalk(c.dt, c.p, T()))),
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
        if (c.state === 'roam' && c.playerDistance < 45 && c.rand() < T().shadowChance) c.enterStalk('curious about you', T());
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
    // Scent (#107): a real trace on the wind (food you opened, blood) draws it to that spot, once per trace.
    seq('Smelled a trace', when('scent', () => (c.state === 'roam' || (c.state === 'investigate' && !c.lure))
        && pc().scentLevel > 0 && pc().lastScent && !(c.scentChecked ??= new Set()).has(pc().lastScent.id)),
      act('follow the scent to its source', () => {
        const s = pc().lastScent;
        c.scentChecked.add(s.id);
        if (c.state === 'investigate') c.retargetNoise(s);
        else c.enterInvestigateNoise(s, `smelled ${s.kind}`);
        c.cautious ??= { every: T().listenEvery, pause: T().listenFor };
        return RUN;
      })),
    seq('Investigating', when('investigating', () => c.state === 'investigate'),
      act('investigate (stop and listen)', () => { c.tickInvestigate(c.dt); return RUN; })),
    seq('Smelled food', act('smell food', () => (c.findLure() ? RUN : FAIL))),
    // Routine (#107): every so often it goes to check a place where it has watched you before
    // (only spots it actually witnessed or found your traces at; never somewhere it hasn't).
    seq('Check a remembered spot', when('routine', () => c.state === 'roam' && (c.routineCooldown = (c.routineCooldown ?? 30) - c.dt) <= 0
        && (pc().routine?.strongest()?.confidence ?? 0) >= 0.5),
      act('go where it has seen you', () => {
        const r = pc().routine.strongest();
        c.routineCooldown = 45;
        c.enterInvestigateNoise(r, `checking where it saw you (${Math.round(r.confidence * 100)}%)`);
        return RUN;
      })),
    act('forage', () => { c.tickRoam(c.dt); return RUN; }),
  );
  return new Brain(root, ctx);
}

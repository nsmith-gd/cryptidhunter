import { sel, seq, when, act, Brain, OK, RUN, FAIL } from './bt.js';

// Default tree for cryptids without a bespoke one (the sandbox Prowler, unknown cryptids):
// roam / investigate noises, calls and bait / stare at glimpses / flee or attack when detected.
export function genericBrain(c) {
  const pc = () => c.perception, B = () => c.profile.behavior;
  const root = sel('Cryptid',
    seq('Attacking', when('attacking', () => c.state === 'aggress'), act('chase', () => { c.tickAggress(c.dt, c.p); return RUN; })),
    seq('Threatened', when('detected', () => c.noticesPlayer() && c.state !== 'flee'),
      sel('React',
        seq('Hostile', when('hostile', () => B().onDetect === 'aggress'), act('attack', () => { c.enterAggress('detected you'); return RUN; })),
        seq('Cornered', when('too close', () => B().turnWithin > 0 && c.playerDistance <= B().turnWithin), act('turn on you', () => { c.enterAggress('cornered'); return RUN; })),
        seq('Fed up', when('chased too often', () => B().turnAfterFlees > 0 && c.flees >= B().turnAfterFlees), act('turn on you', () => { c.enterAggress('fed up with you'); return RUN; })),
        act('flee', () => { c.flees++; c.enterFlee(c.p, 'detected you'); return RUN; }))),
    seq('Fleeing', when('fleeing', () => c.state === 'flee'), act('run', () => {
      if (c.playerDistance > c.profile.fleeSafeDistance && !pc().detected) { c.enterRoam('lost you'); return OK; }
      c.tickFlee(c.dt, c.p); return RUN;
    })),
    seq('Glimpsed', when('half-seen', () => (c.state === 'roam' || c.state === 'investigate') && pc().seen && pc().awareness >= B().observeAt && c.observeCooldown <= 0),
      act('stare', () => { c.enterObserve('glimpsed you'); return RUN; })),
    seq('Staring', when('staring', () => c.state === 'observe'), act('stare', () => { c.tickObserve(c.dt, c.p); return RUN; })),
    seq('Call', when('call', () => (c.pendingCall = c.state === 'investigate' && c.lure ? null : c.hearCall())), act('go to the call', () => {
      if (c.state === 'investigate') { c.retargetNoise(c.pendingCall); c.lookLeft = B().lookAround; } else c.enterInvestigateNoise(c.pendingCall, 'heard a call');
      return RUN;
    })),
    seq('Noise', when('noise', () => (c.state === 'roam' || (c.state === 'investigate' && !c.lure)) && pc().heard && pc().hearLevel >= B().investigateHear && pc().lastHeard),
      act('check the noise', () => { if (c.state === 'investigate') c.retargetNoise(pc().lastHeard); else c.enterInvestigateNoise(pc().lastHeard, 'heard a noise'); return RUN; })),
    seq('Investigating', when('investigating', () => c.state === 'investigate'), act('investigate', () => { c.tickInvestigate(c.dt); return RUN; })),
    seq('Food', act('smell food', () => (c.findLure() ? RUN : FAIL))),
    act('roam', () => { c.tickRoam(c.dt); return RUN; }),
  );
  return new Brain(root, { get level() { return c.level; } });
}

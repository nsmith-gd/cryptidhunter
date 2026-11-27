import { setKit } from '../gear/pack.js';
import { verify } from '../evidence/quality.js';
import { G04 } from '../maps/gymScenes.js';
import { ContourProxy, TerritoryProxy, ScentProxy } from './proxies.js';

// Scripted runs for gyms G02–G04 (#108). Each drives the real game simulation step by step with
// player inputs (held keys, aim) and a few fixture placements, then judges the gym's GDD 15.2 pass
// criteria. Run with ?map=g0N&simpaused, then window.__gym.run() -> { criteria, digest, events }.
// Criteria that need human testers ("4/5 testers can…") come back not_evaluated, as do criteria
// for systems this build doesn't have yet (with the reason).

const DT = 1 / 60;

function tools(g, h) {
  const steps = (n) => { for (let i = 0; i < n; i++) g.sim.step(); };
  const hold = (codes) => { g.input.keys.clear(); for (const c of codes) g.input.keys.add(c); };
  const place = (x, z, yaw = g.player.yaw) => { g.player.position.set(x, 0, z); g.player.velocity.set(0, 0, 0); g.player.yaw = yaw; };
  const face = (x, z) => { const p = g.player.position; g.player.yaw = Math.atan2(-(x - p.x), -(z - p.z)); };
  /** Walk toward (x, z) with real movement (re-aiming each step). Returns true if it got within r. */
  const walkTo = (x, z, { r = 1.2, sprint = false, max = 60 * 60 } = {}) => {
    for (let i = 0; i < max; i++) {
      const p = g.player.position;
      if (Math.hypot(x - p.x, z - p.z) < r) { hold([]); return true; }
      face(x, z); hold(sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW']); g.sim.step();
    }
    hold([]); return false;
  };
  const crit = [];
  const add = (id, text, ok, detail = {}) => crit.push({ id, text, status: ok === null ? 'not_evaluated' : ok ? 'pass' : 'fail', detail });
  const start = () => {
    g.input.locked = true; g.overlay?.classList.add('hidden');
    if (g.hunt.stage === 'briefing') g.hunt.start();
  };
  const finish = () => { hold([]); h.setCriteria(crit); return { gym: h.id, seed: h.seed, criteria: crit, digest: h.digest, events: h.events.length, ticks: h.tick }; };
  return { steps, hold, place, face, walkTo, add, start, finish, crit };
}

// ---- G02 ---------------------------------------------------------------------------------------
export function runG02(g, h) {
  const T = tools(g, h), s = g.survival, P = g.player, L = h.map.landmarks;
  T.start();
  // Load: the same 2.5 s sprint up the short route with a 5 kg and a 20 kg pack. Stamina per metre.
  const sprint = (kg) => {
    setKit({ worn: [{ name: 'gym pack weights', kg }] }); g.loadout.update(0);
    T.place(0, 22, 0); P.stamina = 1; P.exhausted = false;
    T.steps(2);
    const z0 = P.position.z, st0 = P.stamina;
    T.hold(['KeyW', 'ShiftLeft']); T.steps(150); T.hold([]);
    const dist = Math.abs(P.position.z - z0), used = st0 - P.stamina;
    return { kg, dist: +dist.toFixed(2), used: +used.toFixed(4), perMetre: +(used / Math.max(dist, 0.01)).toFixed(5), loadFactor: +P.loadFactor.toFixed(3) };
  };
  const light = sprint(5), heavy = sprint(20);
  setKit({}); g.loadout.update(0);
  T.add('load', 'Higher load consumes more exertion over the same route (stamina per metre, 20 kg vs 5 kg)', heavy.perMetre > light.perMetre * 1.05, { light, heavy });

  T.place(0, 22, 0); P.stamina = 1; P.exhausted = false; T.steps(2);
  const w0 = P.stamina; T.hold(['KeyW']); T.steps(150); T.hold([]);
  T.add('sprint-walk', 'Walking costs no stamina; sprinting does', P.stamina >= w0 - 1e-6 && light.used > 0, { walkChange: +(P.stamina - w0).toFixed(4), sprintUsed: light.used });

  // Food: hungry, eat, nothing else changes.
  s.nutrition.energy = 40; const healthBefore = s.health.value;
  const ate = s.eat?.(); T.steps(600);
  const energyAfter = s.nutrition.energy;
  // Cold and wet: stand in the crossing, then go to the dry shelter.
  T.place(L.crossing.x, L.crossing.z + 0.5, 0);
  const core0 = s.thermo.core; T.steps(1200);
  const wetIn = s.thermo.wetness, coreIn = s.thermo.core, eqIn = s.thermo.equilibrium;
  T.place(L.shelter.x, L.shelter.z, Math.PI); T.steps(1800);
  const wetOut = s.thermo.wetness, coreOut = s.thermo.core;
  T.add('explainable', 'Food, water and cold have explainable effects (eating raises energy; wading soaks you and cools you)',
    !!ate && energyAfter > 40 && s.health.value === healthBefore && wetIn >= 30 && eqIn < core0,
    { ate: ate?.name ?? null, energy: [40, +energyAfter.toFixed(1)], wetIn: +wetIn.toFixed(1), core: [core0, +coreIn.toFixed(2)], equilibriumInWater: +eqIn?.toFixed(2) });
  T.add('rest', 'Safe rest at the shelter interrupts the deterioration (dries you, warms you back up)', wetOut < wetIn && coreOut > coreIn,
    { wet: [+wetIn.toFixed(1), +wetOut.toFixed(1)], core: [+coreIn.toFixed(2), +coreOut.toFixed(2)] });
  T.add('hydration', 'Dehydrate, then drink at the water source', null, { reason: 'no hydration system (S07) in this build yet; the water source is in place for it' });

  // Injury: one authored fall, submitted twice in the same moment: it must count once.
  s.health.value = 100;
  const log0 = s.health.log.length;
  s.health.injure({ cause: 'gym: authored fall', damage: 15, wound: 'bleeding', severity: 'light' });
  s.health.injure({ cause: 'gym: authored fall', damage: 15, wound: 'bleeding', severity: 'light' });
  const once = s.health.log.length - log0 === 1 && Math.abs(s.health.value - 85) < 1e-9;
  T.steps(120);
  const others = () => ({ energy: +s.nutrition.energy.toFixed(4), core: +s.thermo.core.toFixed(4), wet: +s.thermo.wetness.toFixed(4), stamina: +P.stamina.toFixed(4) });
  const before = others(), aid = s.health.firstAid;
  const ok = s.health.bandage();
  const sameTick = JSON.stringify(others()) === JSON.stringify(before);
  T.steps(180);
  T.add('no-double-damage', 'No duplicate health damage (one event per cause, health drops once)', once, { events: s.health.log.length - log0 });
  T.add('owned-recovery', 'Treatment changes only the state it owns (bandage: bleeding and health, one first-aid kit)',
    ok && sameTick && s.health.bleeding.length === 0 && s.health.firstAid === aid - 1, { bandaged: ok, othersUnchanged: sameTick, firstAid: [aid, s.health.firstAid] });
  T.add('testers', '4/5 first-time testers identify the cause and fix of each scripted deficit', null, { reason: 'needs human playtests (GDD 15.3)' });
  T.add('death-cause', 'Record death cause and perceived fairness', null, { reason: 'no death in this script; fairness needs testers', died: s.health.dead });
  return T.finish();
}

// ---- G03 ---------------------------------------------------------------------------------------
export function runG03(g, h) {
  const T = tools(g, h), proxy = h.proxies.find((p) => p instanceof ContourProxy), P = g.player, L = h.map.landmarks;
  T.start();
  // Wait out of sight (facing away at the trailhead) while the proxy makes its rounds.
  T.place(0, 30, Math.PI); T.steps(40 * 60);
  let maxDev = 0;
  const check = () => { const e = proxy.schedule(proxy.time); maxDev = Math.max(maxDev, Math.hypot(e.x - proxy.pos.x, e.z - proxy.pos.z)); };
  check();
  // Stand right on its path, facing it: it doesn't react (schedule only) and leaves no trace while seen.
  const ahead = proxy.schedule(proxy.time + 6);
  T.place(ahead.x + 3, ahead.z + 3); T.face(proxy.pos.x, proxy.pos.z);
  const seenBefore = h.events.filter((e) => e.type === 'no-trace-while-seen').length;
  for (let i = 0; i < 8 * 60; i++) { T.face(proxy.pos.x, proxy.pos.z); g.sim.step(); check(); }
  const seenSkips = h.events.filter((e) => e.type === 'no-trace-while-seen').length - seenBefore;
  const traces = h.events.filter((e) => e.type === 'trace-left');
  T.add('schedule', 'The proxy follows its own schedule whatever the player does', maxDev < 1e-9, { maxDeviation: maxDev });
  T.add('traces-unseen', 'It leaves valid traces while unseen, and none while watched', traces.length > 5 && seenSkips > 0, { traces: traces.length, skippedWhileSeen: seenSkips });

  // Collect without a sighting: photograph one of its prints from close by.
  const prints = g.clues.clues.filter((c) => c.cryptidId === 'gouger-proxy');
  const shoot = (c) => { T.place(c.x, c.z + 1.4); T.face(c.x, c.z); g.player.pitch = -0.85; g.sim.step(); return g.evidence.photographed(); };
  const first = shoot(prints[0]);
  const dupe = shoot(prints[0]);
  const second = shoot(prints[Math.min(prints.length - 1, 4)]);
  T.add('collect', 'Collect useful evidence of it without a direct sighting', !!first, { item: first?.name, clue: first?.clueId });
  T.add('duplicate', 'An exact duplicate pays zero (the same print can\'t be recorded twice)', !!first && dupe === null, { second: dupe });
  T.add('independent', 'Two independent observations are distinguishable', !!second && second.clueId !== first?.clueId, { events: [first?.clueId, second?.clueId] });
  // The ordinary trace: photograph a deer print; HQ verification rejects it, and accepts the proxy's.
  const deer = h.falseTrace[3];
  const deerItem = shoot(deer);
  const vDeer = deerItem && verify(deerItem, 'gouger-proxy'), vReal = first && verify(first, 'gouger-proxy');
  T.add('ordinary', 'The ordinary-animal trace is rejected at verification; the real one is not', vDeer?.verdict === 'rejected' && vReal?.verdict !== 'rejected',
    { deer: vDeer?.reason, real: vReal?.verdict });
  // Camp: pitch the tent at camp A and sleep (time skip at a safe camp).
  T.place(L.campWest.x, L.campWest.z + 1.8, 0);
  const pitched = g.fieldCamp.use(); T.steps(7 * 60);
  const tent = g.fieldCamp.tent;
  if (tent) T.place(tent.x, tent.z);
  g.survival.fatigue.value = 60; T.steps(2);
  const slept = g.fieldCamp.use();
  const t0 = proxy.time;
  for (let i = 0; i < 4000 && g.fieldCamp.sleeping; i++) g.sim.step();
  const log = g.fieldCamp.sleepLog.at(-1);
  T.add('camp-sleep', 'Sleep at a safe camp skips time (the creature keeps its schedule meanwhile)', pitched && slept && !!log && proxy.time - t0 > 30,
    { woke: log?.woke, fatigue: log && [log.fatigueBefore, log.fatigueAfter], creatureSecondsPassed: +(proxy.time - t0).toFixed(1) });
  T.add('payout', 'Evidence-only partial payout and a dossier milestone work', null, { reason: 'settled by the normal debrief and research dossier (#98/#101 checks); the gym has no buyer fixture yet' });
  T.add('lost-device', 'A lost remote camera without a copy loses its evidence', null, { reason: 'trail-camera retrieval and data copies are not in this build yet (GDD 4.3)' });
  T.add('testers', '4/5 testers infer a plausible route and collect something useful; idle waits are not long', null, { reason: 'needs human playtests (GDD 15.3)' });
  return T.finish();
}

// ---- G04 ---------------------------------------------------------------------------------------
export function runG04(g, h) {
  const T = tools(g, h), terr = h.proxies.find((p) => p instanceof TerritoryProxy), nose = h.proxies.find((p) => p instanceof ScentProxy);
  const P = g.player, s = g.survival;
  T.start();
  // Track every proxy step (teleport check) and every scent trace that ever existed (valid signals).
  const last = new Map(h.proxies.map((p) => [p, { ...p.pos }]));
  let maxStep = 0; const traceIds = new Set();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      g.sim.step();
      for (const t of g.scent.traces) traceIds.add(t.id);
      for (const p of h.proxies) { const a = last.get(p); const d = Math.hypot(p.pos.x - a.x, p.pos.z - a.z); maxStep = Math.max(maxStep, d / ((p.constructor.CFG.charge ?? p.constructor.CFG.speed) * DT)); last.set(p, { ...p.pos }); }
    }
  };
  const walk = (x, z, opts = {}) => { for (let i = 0; i < (opts.max ?? 3600); i++) { const p = P.position; if (Math.hypot(x - p.x, z - p.z) < (opts.r ?? 1.2)) break; T.face(x, z); T.hold(['KeyW']); step(); } T.hold([]); };
  // 1. Approach along the NW trail, see and heed the warning, back off.
  walk(0, 12);
  walk(-4, 2);          // ~12.8 m from the lair: inside the warning ring, outside the core
  step(60);
  walk(0, 14);
  step(120);
  const ev = (sys, type) => h.events.filter((e) => e.system === sys && e.type === type);
  const heeded = ev('territory', 'idle').some((e) => e.data.why === 'warning heeded') && !ev('territory', 'charge').length;
  // 2. Ignore it: walk in and stand; it charges after its warning, hits once (nonlethal), then disengages.
  walk(-4, 0);
  for (let i = 0; i < 9 * 60 && !ev('territory', 'hit').length; i++) step();
  const hpAfterHit = s.health.value;
  // 3. Retreat by the safe edge route to the extraction point (still bleeding: the scent follower comes).
  walk(0, 12); walk(16, 12); walk(16, -20); walk(G04.extraction.x, G04.extraction.z, { r: 1.5 });
  const reached = Math.hypot(P.position.x - G04.extraction.x, P.position.z - G04.extraction.z) < 2;
  const disengagedHome = ev('territory', 'idle').some((e) => e.data.why === 'home');
  // 4. Bandage the wound: no new blood. The scent follower works through the last traces and loses contact.
  s.bandage?.();
  for (let i = 0; i < 90 * 60 && !ev('scent', 'lost-contact').length; i++) step();
  step(60);
  const warns = ev('territory', 'warn'), charges = ev('territory', 'charge');
  const validWarns = warns.every((e) => e.data.playerFromHome <= G04.warnR);
  const acquired = ev('scent', 'acquired');
  const validScent = acquired.every((e) => traceIds.has(e.data.trace));
  const leads = charges.map((c) => c.data.lead);
  T.add('valid-signals', 'Creatures act only on valid signals (warning only inside the ring; scent only on real traces)', validWarns && validScent && acquired.length > 0,
    { warnings: warns.map((e) => e.data.playerFromHome), scentAcquisitions: acquired.length, allTracesReal: validScent });
  T.add('no-teleport', 'No proxy ever moves faster than its speed (no unobserved teleport)', maxStep <= 1.01, { maxStepVsSpeed: +maxStep.toFixed(3) });
  T.add('warning', 'A warning always comes first (lead ≥ 2 s), and a heeded warning never leads to an attack', heeded && charges.length > 0 && leads.every((l) => l >= 2),
    { heeded, alertToAttackLead: leads });
  T.add('disengage', 'Leaving the territory makes it disengage and go home (predictable)', disengagedHome, { states: ev('territory', 'disengage').map((e) => e.data.why) });
  T.add('lost-contact', 'Lost contact can be demonstrated (stop the bleeding and the scent follower loses you)', ev('scent', 'lost-contact').length > 0,
    { acquisitions: acquired.length, lost: ev('scent', 'lost-contact').length });
  T.add('retreat', 'Retreat stays physically viable after a nonlethal encounter (reach extraction alive)', reached && !s.health.dead && hpAfterHit > 0,
    { healthAfterHit: +hpAfterHit.toFixed(1), reachedExtraction: reached, healthNow: +s.health.value.toFixed(1) });
  T.add('measures', 'Measure: alert-to-attack lead time, avoidable vs unavoidable deaths, withdrawal choice, gear loss', null,
    { reason: 'recorded for review', alertToAttackLead: leads, deaths: s.health.dead ? 1 : 0, hits: ev('territory', 'hit').length + ev('scent', 'hit').length });
  T.add('testers', '4/5 testers can explain what alerted the creature and one escape response', null, { reason: 'needs human playtests (GDD 15.3)' });
  return T.finish();
}

export const GYM_RUNS = { G02: runG02, G03: runG03, G04: runG04 };

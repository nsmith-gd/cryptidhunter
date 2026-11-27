import { BIGFOOT_TIERS } from './brains/bigfootBrain.js';

// Per-cryptid tuning. The shared CryptidAI reads everything from a profile, so each cryptid
// (Bigfoot, ...) is just a different data entry on the same brain. L0: movement + flee numbers
// and the placeholder capsule size/colour only.

export const DEFAULT_PROFILE = Object.freeze({
  id: 'unknown',
  name: 'Unknown Cryptid',
  // Placeholder body (metres).
  height: 2.0,
  radius: 0.4,
  color: 0x6b5a48,
  // Roam.
  roamRadius: 25,        // how far from home it wanders
  roamSpeed: 1.6,
  roamPause: [1, 4],     // seconds it lingers at each point (min, max)
  // Flee.
  fleeTriggerDistance: 10, // player inside this → bolt
  fleeSafeDistance: 20,    // keeps running until the player is this far away
  fleeSpeed: 6.5,
  fleeStep: 14,            // how far ahead each flee destination is picked
  acceleration: 10,
  turnRate: 7,             // radians / second
  lureRange: 45,           // smells bait this far away (metres)
  catchHits: 1,            // touches before you're caught (Danger & Hunt Failure)
  // Does it frighten you (Fear meter)? Only cryptids that can hurt or catch you do; shy,
  // harmless ones don't raise fear however close they get.
  threatening: false,
  // Clue data for the clues system (not dropped at L0). null = leaves none.
  clues: null,
  // Behaviour state machine (L1, used with senses). See cryptidAI.js.
  behavior: Object.freeze({
    onDetect: 'flee',        // what it does once it has detected you: 'flee' | 'aggress'
    investigateHear: 0.06,   // a noise at least this loud (hear level) sends it to check it out
    investigateSpeed: 1.3,   // x roamSpeed
    lookAround: 4,           // seconds it searches at the spot before going back to roaming
    observeAt: 0.3,          // awareness at which it stops and stares at what it glimpsed
    observeTime: 4,          // seconds it will stare before losing interest
    aggressSpeed: 5.0,       // m/s when it comes for you
    aggressTime: 8,          // seconds it keeps coming before giving up
    aggressGiveUp: 25,       // ...or once you're this far away
    afterAggress: 'roam',    // then: 'roam' | 'flee'
    // A cryptid that normally flees can still turn on you:
    turnWithin: 0,           // ...if it only notices you this close (metres, cornered / surprised); 0 = never
    turnAfterFlees: 0,       // ...or once you've chased it off this many times this hunt; 0 = never
  }),
});

export function makeProfile(overrides = {}) {
  const behavior = Object.freeze({ ...DEFAULT_PROFILE.behavior, ...(overrides.behavior ?? {}) });
  return Object.freeze({ ...DEFAULT_PROFILE, ...overrides, behavior });
}

// Bigfoot: the starter cryptid of Pine Hollow forest. Tall, shy (notices you from further away
// than most) and very fast once it bolts; leaves big footprints and makes wood knocks.
export const BIGFOOT = makeProfile({
  id: 'bigfoot',
  name: 'Bigfoot',
  homeLevel: 1,            // the first hunt: forgiving, it warns before it gets dangerous
  brain: 'bigfoot',        // bespoke behaviour tree (brains/bigfootBrain.js)
  tiers: BIGFOOT_TIERS,    // per-escalation-level tuning its brain reads (and the shared calm rate)
  height: 4.0,             // towering: ~4 m to the top of its crest, shoulders ~1.6 m across
  radius: 0.65,
  color: 0x4a3626,
  roamRadius: 30,
  roamSpeed: 1.8,
  roamPause: [2, 6],
  fleeTriggerDistance: 15, // shy: bolts well before you get close (used only without senses)
  catchHits: 1,            // huge: one grab and the hunt is over
  threatening: true,       // it can turn and charge
  senses: Object.freeze({ hearing: 1.4, sightRange: 32, viewAngle: 65 }), // keen ears and eyes (see perception.js)
  // Shy but curious: checks out noises, stops and stares when it glimpses you (the classic
  // sighting, and your photo chance), then bolts once it's sure.
  // It's not harmless: surprise it up close, or keep hounding it, and it turns and charges.
  behavior: { onDetect: 'flee', observeAt: 0.3, observeTime: 3.5, lookAround: 5,
    turnWithin: 4, turnAfterFlees: 3, aggressSpeed: 5.6, aggressTime: 5, aggressGiveUp: 20, afterAggress: 'flee' },
  fleeSafeDistance: 30,
  fleeSpeed: 8.5,          // faster than the player's sprint (6 m/s): you can't run it down
  fleeStep: 18,
  acceleration: 14,
  turnRate: 6,
  clues: Object.freeze({
    footprint: Object.freeze({ length: 0.7, width: 0.31, stride: 2.3 }), // metres; human boot ~0.3
    hair: Object.freeze({ every: [8, 16], color: 0x5a3a22 }),           // metres walked between tufts
    scratch: Object.freeze({ every: [12, 22], reach: 2.5, height: [2.2, 2.95], length: 0.8 }), // high on the trunk: well above a person's reach
    branch: Object.freeze({ every: [16, 30], reach: 2.2, height: [2.3, 2.9], length: 0.8 }),  // limbs snapped at its shoulder height
    scat: Object.freeze({ every: [55, 90], size: 1.6 }),                                       // big droppings, now and then
    woodKnock: Object.freeze({ intervalSeconds: [20, 60] }),
  }),
});

// Greybox stand-in for an aggressive cryptid on the shared brain (only spawned with ?sandbox):
// same senses, but once it detects you it comes for you instead of running.
export const PROWLER = makeProfile({
  id: 'prowler',
  name: 'Prowler (test)',
  height: 1.3,
  radius: 0.4,
  color: 0x6a2f2f,
  roamRadius: 15,
  roamSpeed: 1.4,
  catchHits: 2,
  threatening: true,
  senses: Object.freeze({ hearing: 1.0, sightRange: 22, viewAngle: 55 }),
  behavior: { onDetect: 'aggress', aggressSpeed: 4.6, aggressTime: 7, aggressGiveUp: 22, afterAggress: 'roam', observeTime: 2 },
});

// SIDEHILL GOUGER (GDD 5.4, level 02): a data-only species on the shared framework (#86). No code
// of its own: the utility brain, the quadruped body family and the clue trail all read this entry.
// A grazer with legs shorter on one side for hillsides; keeps walking the same way along the slope,
// has acute hearing, and bolts when startled. No predator threat: it never turns on you.
export const GOUGER = makeProfile({
  id: 'gouger',
  name: 'Sidehill Gouger',
  homeLevel: 1,
  brain: 'utility',
  model: 'quadruped',
  height: 1.1, radius: 0.45, length: 1.5,
  legs: { left: 0.42, right: 0.62 },       // uphill legs shorter: it leans into the slope
  color: 0x6f6350,
  roamRadius: 26, roamSpeed: 1.2, roamPause: [3, 8],
  roamStyle: 'contour',                    // grazes along one height round the hill, one way (#130)
  fleeStyle: 'contour',                    // bolts along the slope: easy going for it, hard for you
  // Stalks you while you're not looking (#130): from `far` metres, closing to `near` as dusk falls
  // and as you go deeper; frozen while watched; bolts if you come within `startle` or stare too long.
  stalk: Object.freeze({ range: 110, far: 42, near: 15, startle: 11, holdStare: 4 }),
  fleeSafeDistance: 28, fleeSpeed: 6.8, fleeStep: 16, acceleration: 9, turnRate: 5,
  catchHits: 99, threatening: false,       // harmless
  senses: Object.freeze({ hearing: 2.0, sightRange: 18, viewAngle: 70 }),   // acute sound
  traits: Object.freeze({ fear: 0.85, curiosity: 0.35, aggression: 0, territoriality: 0, alertness: 0.8, habituation: 0.3 }),
  actions: Object.freeze(['roam', 'feed', 'investigate', 'observe', 'stalk', 'flee', 'return']),
  behavior: { onDetect: 'flee', observeAt: 0.25, observeTime: 2.5, lookAround: 3, investigateSpeed: 0.9 },
  clues: Object.freeze({
    footprint: Object.freeze({ length: 0.13, width: 0.09, stride: 0.75, uneven: 0.7 }),   // small cloven prints, the short-legged side 30% shorter
    hair: Object.freeze({ every: [14, 24], color: 0x8a7a5e }),
  }),
});

// CHUPACABRA (#93): the species entry for the framework registry. Its stalk-and-pounce behaviour
// is its own (chupacabra.js); the body comes from the registered 'chupacabra' model.
export const CHUPACABRA = makeProfile({
  id: 'chupacabra',
  name: 'Chupacabra',
  homeLevel: 3,
  model: 'chupacabra',
  height: 0.6, radius: 0.3, length: 1.1,
  color: 0x454b38,
  catchHits: 3,
  threatening: true,
  senses: Object.freeze({ hearing: 1.2, sightRange: 35, viewAngle: 70 }),
});

export const PROFILES = Object.freeze({ default: DEFAULT_PROFILE, bigfoot: BIGFOOT, prowler: PROWLER, gouger: GOUGER, chupacabra: CHUPACABRA });

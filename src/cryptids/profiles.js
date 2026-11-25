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
  height: 3.4,             // towering: ~3.4 m to the top of its crest, shoulders ~1.4 m across
  radius: 0.6,
  color: 0x4a3626,
  roamRadius: 30,
  roamSpeed: 1.8,
  roamPause: [2, 6],
  fleeTriggerDistance: 15, // shy: bolts well before you get close (used only without senses)
  catchHits: 1,            // huge: one grab and the hunt is over
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
    footprint: Object.freeze({ length: 0.6, width: 0.27, stride: 2.0 }), // metres; human boot ~0.3
    hair: Object.freeze({ every: [8, 16], color: 0x5a3a22 }),           // metres walked between tufts
    scratch: Object.freeze({ every: [12, 22], reach: 2.5, height: [2.0, 2.8], length: 0.7 }), // shoulder height on a 3.4 m body: well above a person
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
  senses: Object.freeze({ hearing: 1.0, sightRange: 22, viewAngle: 55 }),
  behavior: { onDetect: 'aggress', aggressSpeed: 4.6, aggressTime: 7, aggressGiveUp: 22, afterAggress: 'roam', observeTime: 2 },
});

export const PROFILES = Object.freeze({ default: DEFAULT_PROFILE, bigfoot: BIGFOOT, prowler: PROWLER });

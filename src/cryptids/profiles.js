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
});

export function makeProfile(overrides = {}) {
  return Object.freeze({ ...DEFAULT_PROFILE, ...overrides });
}

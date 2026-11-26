// Seeded randomness (GDD 14.2: same seed + input trace + fixture = same state).
// One world seed per run; every system draws from its own named stream derived from it, so a
// change in how often one system rolls dice never shifts another system's results.
//
//   setSeed(1234)            // once, before the world is built (main.js reads ?seed=)
//   const rand = stream('cryptid:bigfoot');  rand() -> [0, 1)
//
// Purely cosmetic jitter that never touches game state (e.g. audio pitch wobble) may still use
// Math.random; anything that changes positions, timings, choices or spawned objects must not.

let worldSeed = 1;
const streams = new Map();

/** Set the world seed and reset all streams. */
export function setSeed(seed) {
  worldSeed = (Number(seed) >>> 0) || 1;
  streams.clear();
}

export function getSeed() { return worldSeed; }

/** A fresh seed for runs that didn't ask for one (logged so the run can be replayed). */
export function randomSeed() { return ((Date.now() ^ (performance.now() * 1000)) >>> 0) % 1000000000 || 1; }

/** The named stream (created on first use from the world seed and the name). */
export function stream(name) {
  let s = streams.get(name);
  if (!s) { s = mulberry32(hash32(`${worldSeed}:${name}`)); streams.set(name, s); }
  return s;
}

/** A standalone generator for a given numeric seed (fixtures, tests). */
export function makeRng(seed) { return mulberry32(seed >>> 0); }

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit string hash. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

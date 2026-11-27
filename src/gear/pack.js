// Pack, mass/volume and load penalty (#69; GDD 1.2 S03, 2.3 D03, 2.8, 3.5, 13.1).
//
// You carry: worn kit (clothes, boots, torch, camera), the 4 quick slots (belt and chest pouches,
// instant to use), and one pack behind them. The pack holds gear you didn't slot, food and water,
// but only up to its volume, and digging something out takes a moment. Everything you carry has
// mass; the total is your load, and the load ratio (load / what a fit adult carries all day)
// slows you down and makes running cost more stamina, using the GDD 2.8 formulas and floors:
//   movement_speed = action_speed * max(0.45, 1 - load_penalty - ...)
//   exertion_cost  = action_cost * load_factor
// A bigger pack holds more, but doesn't make you stronger.

/** Per-unit mass (kg) and volume (L). Numbers are prototype tuning, not real-world specs. */
export const ITEM_SPECS = {
  bait: { kg: 1.0, L: 1.5 },               // a sealed tub of bait
  trailCamera: { kg: 0.6, L: 1.0 },
  audioLure: { kg: 0.5, L: 0.8 },
  nightVision: { kg: 0.9, L: 1.2 },
  knockStick: { kg: 0.8, L: 1.0 },
  spareBatteries: { kg: 0.05, L: 0.05 },
  repairKit: { kg: 0.09, L: 0.1 },        // per use: a 5-use kit is 0.45 kg (D10)
  water: { kg: 1.0, L: 1.0 },              // a 1 L bottle
  packedLunch: { kg: 0.45, L: 0.6 },
  trailSnack: { kg: 0.15, L: 0.2 },
  // Field kit (#87), GDD 3.2 masses.
  binoculars: { kg: 0.35, L: 0.6 },        // F03
  whistle: { kg: 0.02, L: 0.02 },          // C06
  fieldRecorder: { kg: 0.18, L: 0.2 },     // F05
  bivy: { kg: 0.2, L: 0.5 },               // D02
  dryClothes: { kg: 0.5, L: 2.0 },         // B04 (a bundle)
  fireKit: { kg: 0.1, L: 0.15 },           // D06 (6 uses)
  // Hydration (#103).
  tagLauncher: { kg: 0.5, L: 0.6 },        // F16 tracking tags + launcher (#147), per tag
  canteen: { kg: 0.15, L: 1.1 },           // A03, empty; its water is counted below
  canteenWater: { kg: 1.0, L: 0 },         // litres in the canteen (inside its volume)
  purTablets: { kg: 0.005, L: 0.005 },     // A07, per tablet
  tent: { kg: 2.2, L: 6 },                 // D03 two-person tent (#104)
};

/** Worn kit: always carried, counted once (GDD 13.1 "worn mass included once"). */
export const WORN = [
  { name: 'Clothes and boots', kg: 3.2 },
  { name: 'Flashlight', kg: 0.4 },
  { name: 'Camera', kg: 0.9 },
  { name: 'Map and compass', kg: 0.15 },
];

/** B03 Daypack (12 L) is the starter pack. */
export const PACKS = {
  daypack: { name: 'Daypack', L: 12, kg: 0.45 },
};

/**
 * The kit you're taking this trip, set by the base-camp supplier (#88): the pack you carry (B07
 * trail pack instead of the daypack) and extra worn mass from owned or rented gear (net of what it
 * replaces). Every load calculation reads it, so the HUD, the prep panel and the picker agree.
 */
export const KIT = { bag: PACKS.daypack, worn: [] };
export function setKit({ bag = null, worn = [] } = {}) { KIT.bag = bag ?? PACKS.daypack; KIT.worn = worn; }

export const LOAD = {
  referenceKg: 30,       // load ratio 1.0: a heavy all-day load for a fit adult
  maxKg: 45,             // can't shoulder more than this at all
  freeRatio: 0.35,       // light loads (worn kit and the starter kit) cost almost nothing
  speedPerRatio: 1.0,    // load_penalty per unit of ratio above the free amount
  speedFloor: 0.45,      // GDD 2.8 floor on movement speed
  exertionPerRatio: 1.6, // extra stamina cost per unit of ratio above the free amount
};

export const WATER_MAX = 8;

/**
 * Totals for a manifest. quick/pack: { itemId: count }. Returns masses (kg), pack volume (L),
 * load ratio and the derived movement and exertion multipliers.
 */
export function computeLoad({ quick = {}, pack = {}, bag = KIT.bag } = {}) {
  const kgOf = (m) => Object.entries(m).reduce((a, [id, n]) => a + (ITEM_SPECS[id]?.kg ?? 0) * Math.max(0, n), 0);
  const volume = Object.entries(pack).reduce((a, [id, n]) => a + (ITEM_SPECS[id]?.L ?? 0) * Math.max(0, n), 0);
  const worn = [...WORN, ...KIT.worn].reduce((a, w) => a + w.kg, 0);
  const quickKg = kgOf(quick), packKg = kgOf(pack) + bag.kg;
  const total = worn + quickKg + packKg;
  return { worn, quickKg, packKg, total, volume, capacity: bag.L, ...loadEffects(total) };
}

/** Load ratio and its effects (GDD 2.8). */
export function loadEffects(totalKg) {
  const ratio = totalKg / LOAD.referenceKg;
  const over = Math.max(0, ratio - LOAD.freeRatio);
  const loadPenalty = over * LOAD.speedPerRatio;
  return {
    ratio,
    loadPenalty,
    speedScale: Math.max(LOAD.speedFloor, 1 - loadPenalty),
    loadFactor: 1 + over * LOAD.exertionPerRatio,
    band: ratio < 0.45 ? 'light' : ratio < 0.65 ? 'moderate' : ratio < 0.85 ? 'heavy' : 'overloaded',
  };
}

/** Would adding `n` of item `id` to the pack fit? Returns null if it fits, else the reason. */
export function packRefusal(load, id, n = 1) {
  const s = ITEM_SPECS[id];
  if (!s) return null;
  if (load.volume + s.L * n > load.capacity + 1e-9) return `pack is full (${load.capacity} L)`;
  if (load.total + s.kg * n > LOAD.maxKg + 1e-9) return `too heavy to carry (${LOAD.maxKg} kg max)`;
  return null;
}

/** One line for HUDs and the loadout screen. */
export function loadSummary(load) {
  const pct = Math.round(load.ratio * 100);
  const slow = Math.round((1 - load.speedScale) * 100);
  return `PACK ${load.volume.toFixed(1)}/${load.capacity} L · LOAD ${load.total.toFixed(1)} kg (${pct}%, ${load.band})` +
    (slow > 0 ? ` · speed −${slow}% · stamina ×${load.loadFactor.toFixed(2)}` : '');
}

import { RAMPS, ramp } from './palette.js';

// Colour-grading ramps per time of day and biome (#34). Every colour here is a master-palette
// entry (src/art/palette.js), so sky, fog, ambient and lights stay inside the palette.
//
// A grade sets the mood of a scene: what the sky and haze look like, how the shadows are
// tinted (ambient sky/ground), the key light (low sun or moon), and the warm practical accent.
//   dusk  — warm low sun bleeding into violet shadows; the last light before the hunt.
//   night — cold moonlight, deep blue haze, warm practicals are the only warm colour.
//   dawn  — pale cold light from the east, fog lifting; the hunt is over.
// Forest leans blue/teal; swamp leans sickly green.

const g = (o) => Object.freeze(o);

export const GRADES = Object.freeze({
  'forest-dusk': g({
    sky: ramp('litter', 2), horizon: ramp('warm', 1), fog: ramp('dirt', 3), fogDensity: 0.03,
    ambientSky: ramp('night', 4), ambientGround: ramp('dirt', 1), ambient: 0.65,
    key: ramp('warm', 3), keyIntensity: 1.3, keyDir: [-0.9, 0.18, -0.4],
    accent: ramp('warm', 4), shadowTint: ramp('night', 2),
  }),
  'forest-night': g({
    sky: ramp('night', 1), horizon: ramp('night', 3), fog: ramp('night', 2), fogDensity: 0.045,
    ambientSky: ramp('night', 4), ambientGround: ramp('dirt', 0), ambient: 0.55,
    key: ramp('night', 6), keyIntensity: 0.9, keyDir: [-0.4, 0.55, -0.8],
    accent: ramp('warm', 3), shadowTint: ramp('night', 1),
  }),
  'forest-dawn': g({
    sky: ramp('night', 5), horizon: ramp('warm', 5), fog: ramp('night', 5), fogDensity: 0.05,
    ambientSky: ramp('night', 5), ambientGround: ramp('moss', 1), ambient: 0.9,
    key: ramp('warm', 5), keyIntensity: 0.7, keyDir: [0.9, 0.15, 0.3],
    accent: ramp('warm', 4), shadowTint: ramp('night', 3),
  }),
  'swamp-dusk': g({
    sky: ramp('rust', 2), horizon: ramp('warm', 2), fog: ramp('moss', 2), fogDensity: 0.04,
    ambientSky: ramp('moss', 4), ambientGround: ramp('water', 0), ambient: 0.6,
    key: ramp('warm', 3), keyIntensity: 1.1, keyDir: [-0.9, 0.15, -0.3],
    accent: ramp('warm', 4), shadowTint: ramp('water', 1),
  }),
  'swamp-night': g({
    sky: ramp('water', 1), horizon: ramp('water', 3), fog: ramp('water', 2), fogDensity: 0.05,
    ambientSky: ramp('water', 4), ambientGround: ramp('water', 0), ambient: 0.6,
    key: ramp('water', 6), keyIntensity: 0.75, keyDir: [-0.35, 0.4, -1],
    accent: ramp('warm', 3), shadowTint: ramp('water', 0),
  }),
  'swamp-dawn': g({
    sky: ramp('water', 5), horizon: ramp('grass', 5), fog: ramp('water', 5), fogDensity: 0.06,
    ambientSky: ramp('water', 5), ambientGround: ramp('moss', 1), ambient: 0.85,
    key: ramp('grass', 6), keyIntensity: 0.6, keyDir: [0.9, 0.12, 0.3],
    accent: ramp('warm', 4), shadowTint: ramp('water', 3),
  }),
});

/** Every colour any grade uses (all must be palette colours). */
export function gradeColours() {
  const out = new Set();
  for (const gr of Object.values(GRADES)) for (const v of Object.values(gr)) if (typeof v === 'string') out.add(v);
  return [...out];
}

export { RAMPS };

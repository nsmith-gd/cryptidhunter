// Cryptid Hunter master palette (see docs/art-style-guide.md).
// Every painted texture picks its colours from these ramps. Each ramp runs dark -> light and is
// hue-shifted: shadows lean cool (blue/violet), lights lean warm (yellow/orange), so surfaces
// stay rich under the cold moon and glow under warm practical lights. No pure black, no pure white.

export const TEXEL_DENSITY = 32;   // texels per metre on world surfaces (1 texel = 3.125 cm)
export const HERO_DENSITY = 64;    // texels per metre on hero props and creature faces/hands

export const RAMPS = Object.freeze({
  // Pine and cypress bark: cool umber shadows to dusty ochre ridges.
  bark: ['#161219', '#261c1f', '#3a2a26', '#50392e', '#6a4c39', '#856447', '#a3825d'],
  // Weathered wood (planks, cabins, fences): greyer and lighter than living bark.
  wood: ['#17151a', '#2a2526', '#403732', '#584b40', '#73614f', '#8f7b63', '#ad987b'],
  // Pine needles and conifer foliage: blue-black to sage.
  needles: ['#0b1416', '#12221f', '#1b3328', '#264532', '#355a3c', '#4a7149', '#668a5a'],
  // Moss and ground cover: deep teal-green to yellow-green highlights.
  moss: ['#101914', '#1a2a1a', '#273d1f', '#375425', '#4c6d2d', '#678838', '#8aa449'],
  // Grass and dry grass tips.
  grass: ['#141a12', '#202b16', '#33411c', '#4b5823', '#66712c', '#857f38', '#a8964c'],
  // Forest dirt and trail: violet-brown shadow to warm clay.
  dirt: ['#120f14', '#1f1a1c', '#302623', '#43342b', '#584434', '#6f563f', '#89704f'],
  // Leaf litter: rust and amber accents sitting on dirt.
  litter: ['#24151a', '#3e1f1c', '#5b2c20', '#7a3e24', '#98552b', '#b56f36', '#cf9149'],
  // Granite and boulders: blue-grey with lichen-warm lights.
  rock: ['#121418', '#1e2126', '#2d3137', '#40454b', '#565b5f', '#6f7373', '#8c8e88'],
  // Lichen accents for rock and bark.
  lichen: ['#3a4a3a', '#56684c', '#7a8a5e', '#a3a878'],
  // Water (creek, swamp): black-teal depths to pale moonlit glints.
  water: ['#071012', '#0c1a1d', '#132629', '#1d3639', '#2c4a4b', '#4a6a66', '#8aa39a'],
  // Creature fur (Bigfoot): near-black brown to ginger tips.
  fur: ['#110c0c', '#1c1310', '#2b1d15', '#3d2a1c', '#523823', '#6c4a2d', '#8b613b'],
  // Bare creature skin (face, palms, soles).
  skin: ['#1a1416', '#2a2121', '#3b2f2b', '#4e4038', '#64534a'],
  // Warm practical light accents (lanterns, fire, eyeshine, sodium lamps).
  warm: ['#5a2414', '#9a3f17', '#d0661c', '#f0952c', '#ffc35c', '#ffe6a8'],
  // Night sky, moonlight and fog.
  night: ['#05070c', '#0b1220', '#162231', '#24354a', '#3a5068', '#6a83a0', '#b6c6dc'],
  // Rust and old metal (vehicles, cans, tin roofs).
  rust: ['#1e1414', '#3a1f17', '#5e2f1a', '#7e4422', '#9c5e30', '#b98049'],
});

/** Flat list of every palette colour (for swatch sheets and palette checks). */
export const PALETTE = Object.freeze(Object.values(RAMPS).flat());

/** Ramp lookup with clamping: ramp('bark', 2). */
export function ramp(name, i) {
  const r = RAMPS[name];
  return r[Math.max(0, Math.min(r.length - 1, i))];
}

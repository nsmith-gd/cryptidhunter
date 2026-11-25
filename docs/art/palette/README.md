# Cryptid Hunter palette files

Generated from `src/art/palette.js` (master palette) and `src/art/grading.js` (grades) by `node tools/build-palette.mjs`.

| File | What it is |
|---|---|
| `master.gpl` | Master palette (98 colours, 15 hue-shifted ramps) for GIMP, Aseprite, Krita |
| `master.hex` | Same colours, one hex per line (Lospec / Pyxel Edit / Photoshop import) |
| `master.json` | Ramps by name + texel density (32 per metre) |
| `grades.json` | Colour grades: sky, horizon, fog, ambient, key light, accent and shadow tint per biome and time of day |
| `grade-*.png` | The Pine Hollow test diorama rendered through the palette pass in each grade (every pixel is a palette colour) |

Grades (all colours are palette entries):
- **forest-dusk**: warm low sun bleeding into violet shadows, amber haze.
- **forest-night**: cold moonlight, deep blue haze; warm practical lights are the only warm colour.
- **forest-dawn**: pale cold sky, warm horizon, lifting blue-grey fog.
- **swamp-dusk / swamp-night / swamp-dawn**: same structure, sickly teal-green water haze instead of blue.

The palette render pass (`src/art/paletteQuantize.js`) snaps every output pixel to the master palette; the test `node tools/check-t34.mjs` reads back every pixel of each graded render and fails if any colour is off-palette.

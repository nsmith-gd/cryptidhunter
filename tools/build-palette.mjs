// Writes the master palette and grading ramps to swatch files in docs/art/palette/.
// Run: node tools/build-palette.mjs   (source of truth: src/art/palette.js, src/art/grading.js)
import { mkdirSync, writeFileSync } from 'node:fs';
import { RAMPS, PALETTE, TEXEL_DENSITY } from '../src/art/palette.js';
import { GRADES } from '../src/art/grading.js';

const dir = 'docs/art/palette';
mkdirSync(dir, { recursive: true });
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// GIMP / Aseprite / Krita palette.
const gpl = ['GIMP Palette', 'Name: Cryptid Hunter master', `Columns: 7`, '#'];
for (const [name, cols] of Object.entries(RAMPS)) cols.forEach((h, i) => gpl.push(`${rgb(h).map((v) => String(v).padStart(3)).join(' ')}\t${name}-${i}`));
writeFileSync(`${dir}/master.gpl`, gpl.join('\n') + '\n');
// Plain hex list (one per line) for tools that take that.
writeFileSync(`${dir}/master.hex`, PALETTE.map((h) => h.slice(1)).join('\n') + '\n');
writeFileSync(`${dir}/master.json`, JSON.stringify({ texelDensity: TEXEL_DENSITY, count: PALETTE.length, ramps: RAMPS }, null, 2) + '\n');
writeFileSync(`${dir}/grades.json`, JSON.stringify(GRADES, null, 2) + '\n');
console.log(`wrote ${PALETTE.length} colours in ${Object.keys(RAMPS).length} ramps, ${Object.keys(GRADES).length} grades to ${dir}`);

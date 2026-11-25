import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, RAMPS } from '../src/art/palette.js';
import { GRADES, gradeColours } from '../src/art/grading.js';

test('palette colours are valid hex and unique', () => {
  for (const h of PALETTE) assert.match(h, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(PALETTE).size, PALETTE.length);
});

test('ramps run dark to light', () => {
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, v, i) => a + v * [0.3, 0.59, 0.11][i], 0);
  for (const [name, r] of Object.entries(RAMPS)) for (let i = 1; i < r.length; i++) assert.ok(lum(r[i]) > lum(r[i - 1]), `${name}[${i}]`);
});

test('every grade colour is a master-palette colour', () => {
  const set = new Set(PALETTE);
  for (const c of gradeColours()) assert.ok(set.has(c), c);
});

test('there is a dusk, night and dawn grade for forest and swamp', () => {
  for (const b of ['forest', 'swamp']) for (const t of ['dusk', 'night', 'dawn']) assert.ok(GRADES[`${b}-${t}`], `${b}-${t}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityQ, gradeOf, gradeRecord, verify, sourceOf, GRADES } from '../src/evidence/quality.js';

test('Q formula: round(100 x (0.30C + 0.35I + 0.20K + 0.15P) x integrity)', () => {
  assert.equal(qualityQ({ C: 1, I: 1, K: 1, P: 1 }), 100);
  assert.equal(qualityQ({ C: 0.5, I: 0.5, K: 0.5, P: 0.5 }), 50);
  assert.equal(qualityQ({ C: 1, I: 0, K: 0, P: 0 }), 30);
  assert.equal(qualityQ({ C: 1, I: 1, K: 1, P: 1 }, 0.5), 50);
});

test('grade thresholds 20/40/60/80 and multipliers 0/0.25/0.55/0.80/1.0', () => {
  assert.deepEqual([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map((q) => gradeOf(q).grade), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(GRADES.map((g) => g.M), [0, 0.25, 0.55, 0.8, 1]);
});

test('a dark photo grades low with a visible reason', () => {
  const r = gradeRecord({ quality: { C: 0.08, I: 0.05, K: 0.9, P: 1, light: 0.1, steadiness: 1 } });
  assert.ok(r.grade <= 1, `grade ${r.grade}`);
  assert.equal(r.reason, 'too dark');
});

test('blurry and out-of-frame shots name their problem', () => {
  assert.ok(gradeRecord({ quality: { C: 0.3, I: 0.7, K: 1, P: 1, light: 0.9, steadiness: 0.4 } }).reasons.includes('blurry'));
  assert.ok(gradeRecord({ quality: { C: 0.9, I: 0.7, K: 0.3, P: 1, light: 0.9, steadiness: 1 } }).reasons.includes('subject out of frame or hidden'));
  assert.equal(gradeRecord({ quality: { C: 1, I: 1, K: 1, P: 1, light: 1, steadiness: 1 } }).reason, 'clear and complete');
});

test('a sharp photo of an ordinary animal is rejected for the cryptid claim, with a reason', () => {
  const rec = { quality: { C: 1, I: 1, K: 1, P: 1, light: 1, steadiness: 1 }, source: { kind: 'clue', actual: 'deer (ordinary animal)' } };
  const v = verify(rec, 'Bigfoot');
  assert.equal(v.verdict, 'rejected');
  assert.equal(v.M, 0);
  assert.equal(v.grade, 4);                      // quality is not authenticity
  assert.match(v.reason, /ordinary animal: a deer/);
});

test('the claimed cryptid is accepted at its grade; another cryptid is rejected; unknown is ambiguous (grade <= 1)', () => {
  const good = { quality: { C: 0.9, I: 0.8, K: 1, P: 1, light: 0.9, steadiness: 1 } };
  assert.equal(verify({ ...good, source: { actual: 'Bigfoot' } }, 'Bigfoot').verdict, 'accepted');
  assert.equal(verify({ ...good, source: { actual: 'Mothman' } }, 'Bigfoot').verdict, 'rejected');
  const amb = verify({ ...good, source: {} }, 'Bigfoot');
  assert.equal(amb.verdict, 'ambiguous');
  assert.ok(amb.grade <= 1 && amb.M <= 0.25);
});

test('structured source tags work too', () => {
  assert.deepEqual(sourceOf({ source: { origin: 'ordinary', species: 'fox' } }), { origin: 'ordinary', species: 'fox' });
  assert.match(verify({ quality: { C: 1, I: 1, K: 1, P: 1 }, source: { origin: 'ordinary', species: 'owl' } }, 'Bigfoot').reason, /owl/);
});

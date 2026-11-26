import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAttempt, emptyResearch, confidence, buyersFor, unlockStatus, photoGrade } from '../src/research/dossier.js';

const BF = { id: 'bigfoot', name: 'Bigfoot' };
const att = (id, o = {}) => ({ id, extracted: true, species: BF, signs: [], records: [], findings: [], ...o });

test('a dossier starts at Lead with no credibility', () => {
  const { research } = addAttempt(emptyResearch(), att('a1'));
  assert.equal(research.species.bigfoot.milestones.lead, 'witness report');
  assert.equal(research.credibility, 0);
});

test('one verified sign locates the target (+1); two ambiguous signs from different events also do', () => {
  let { research, newly } = addAttempt(emptyResearch(), att('a1', { signs: [{ id: 'c1', verified: true, compatible: true }] }));
  assert.deepEqual(newly.map((n) => n.milestone), ['located']);
  assert.equal(research.credibility, 1);
  ({ research, newly } = addAttempt(emptyResearch(), att('a1', { signs: [{ id: 'c1', verified: false, compatible: true }] })));
  assert.equal(newly.length, 0);
  ({ newly } = addAttempt(research, att('a2', { signs: [{ id: 'c9', verified: false, compatible: true }] })));
  assert.deepEqual(newly.map((n) => n.milestone), ['located']);
});

test('an ambiguous record (grade 1) earns no credibility; a grade-2 record documents (+2)', () => {
  let { research, newly, ignored } = addAttempt(emptyResearch(), att('a1', { records: [{ id: 'p1', family: 'photo', grade: 1, target: true }] }));
  assert.equal(newly.length, 0);
  assert.equal(research.credibility, 0);
  assert.match(ignored[0], /ambiguous/);
  ({ research, newly } = addAttempt(research, att('a2', { records: [{ id: 'p2', family: 'photo', grade: photoGrade(50), target: true }] })));
  assert.deepEqual(newly.map((n) => n.milestone), ['documented']);
  assert.equal(research.credibility, 2);
});

test('credibility is awarded once per milestone, even when it is met again', () => {
  let { research } = addAttempt(emptyResearch(), att('a1', { records: [{ id: 'p', family: 'photo', grade: 3, target: true }] }));
  ({ research } = addAttempt(research, att('a2', { records: [{ id: 'p', family: 'photo', grade: 4, target: true }] })));
  assert.equal(research.credibility, 2);
});

test('nothing counts from an attempt you did not extract from', () => {
  const { research, newly } = addAttempt(emptyResearch(), { ...att('a1', { records: [{ id: 'p', family: 'photo', grade: 4, target: true }] }), extracted: false });
  assert.equal(newly.length, 0);
  assert.equal(research.credibility, 0);
});

test('characterized needs two different verified behaviours (+2)', () => {
  let { newly, research } = addAttempt(emptyResearch(), att('a1', { findings: [{ id: 'k', behaviour: 'knock', verified: true }] }));
  assert.equal(newly.length, 0);
  ({ newly } = addAttempt(research, att('a2', { findings: [{ id: 'w', behaviour: 'warning', verified: true }] })));
  assert.deepEqual(newly.map((n) => n.milestone), ['characterized']);
});

test('confirmed needs 2 events, 2 families and a confidence score of 90 (event cap 70)', () => {
  // One exceptional photo event alone: capped at 70, one family -> not confirmed.
  let { research } = addAttempt(emptyResearch(), att('a1', { records: [{ id: 'p', family: 'photo', grade: 4, target: true }] }));
  assert.ok(!research.species.bigfoot.milestones.confirmed);
  assert.equal(confidence(research.species.bigfoot).score, 70);
  // A second event with a compelling physical trace: 70 + 52.5 = 122.5, 2 families -> confirmed (+3).
  const r2 = addAttempt(research, att('a2', { records: [{ id: 't', family: 'trace', grade: 3, target: true }] }));
  assert.ok(r2.newly.some((n) => n.milestone === 'confirmed'));
  // Two photo events only (one family) never confirm, however good.
  let r3 = addAttempt(emptyResearch(), att('b1', { records: [{ id: 'p', family: 'photo', grade: 4, target: true }] }));
  r3 = addAttempt(r3.research, att('b2', { records: [{ id: 'p', family: 'photo', grade: 4, target: true }] }));
  assert.ok(!r3.research.species.bigfoot.milestones.confirmed);
});

test('buyers: enthusiasts always; foundations need expedition 4 and credibility 6', () => {
  const at = (level, credibility) => Object.fromEntries(buyersFor({ level, credibility }).map((b) => [b.id, b.open]));
  assert.equal(at(1, 0).enthusiasts, true);
  assert.equal(at(1, 0).folklore, false);
  assert.equal(at(2, 0).folklore, true);
  assert.equal(at(4, 5).foundation, false);
  assert.equal(at(4, 6).foundation, true);
});

test('next map unlocks with a successful extraction + Documented + affordability', () => {
  const swamp = { id: 'swamp', after: { map: 'forest', mapName: 'Pine Hollow', species: 'bigfoot', speciesName: 'Bigfoot' }, tripCents: 4000 };
  let { research } = addAttempt(emptyResearch(), att('a1', { records: [{ id: 'p', family: 'photo', grade: 2, target: true }] }));
  assert.equal(unlockStatus(swamp, { research, extractedFrom: [], moneyCents: 9999 }).open, false);
  assert.equal(unlockStatus(swamp, { research, extractedFrom: ['forest'], moneyCents: 100 }).open, false);
  assert.equal(unlockStatus(swamp, { research, extractedFrom: ['forest'], moneyCents: 4000 }).open, true);
  assert.equal(unlockStatus(swamp, { research: emptyResearch(), extractedFrom: ['forest'], moneyCents: 9999 }).open, false);
});

import { judgeSign, fieldRecords } from '../src/research/fieldRecords.js';

test('a huge footprint is a verified Bigfoot sign; a low snapped branch is only ambiguous; deer tracks say nothing', () => {
  assert.equal(judgeSign({ type: 'footprint', data: { length: 0.45 } }, 'bigfoot').verified, true);
  const branch = judgeSign({ type: 'branch', y: 1 }, 'bigfoot');
  assert.equal(branch.verified, false);
  assert.equal(branch.compatible, true);
  assert.equal(judgeSign({ type: 'deerTrack' }, 'bigfoot'), null);
});

test('field records: photo grades from score, the target flagged, behaviours de-duplicated', () => {
  const r = fieldRecords({ target: 'Bigfoot', photos: [{ subject: 'Bigfoot', score: 20 }, { subject: 'Mothman', score: 90 }],
    knocks: [{ who: 'Bigfoot' }, { who: 'Bigfoot' }, { who: 'player' }], events: [{ type: 'whoop', name: 'Bigfoot' }, { type: 'rock', name: 'Bigfoot' }] });
  assert.deepEqual(r.records.map((x) => [x.grade, x.target]), [[1, true], [4, false]]);
  assert.deepEqual(r.findings.map((f) => f.behaviour), ['knock', 'warning']);
});

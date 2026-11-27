import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TagTrack, TAGGING } from '../src/research/tagging.js';

const good = { inRange: true, signal: 0.8 };

test('Untracked -> Tagged only inside an opportunity window, with a compatible tag', () => {
  const t = new TagTrack();
  assert.equal(t.state, 'Untracked');
  assert.equal(t.tag(1, { opportunity: false }).reason, 'no opportunity window');
  assert.equal(t.tag(1, { opportunity: true, compatible: false }).reason, 'incompatible tag');
  assert.equal(t.state, 'Untracked');
  assert.equal(t.tag(2, { opportunity: true }).ok, true);
  assert.equal(t.state, 'Tagged');
  assert.equal(t.tag(3, { opportunity: true }).reason, 'already tagged');
  assert.equal('captured' in t, false, 'tagged is not captured');
});

test('three valid telemetry updates make one interval', () => {
  const t = new TagTrack();
  t.tag(0, { opportunity: true });
  assert.equal(t.telemetry(10, good).counted, true);
  assert.equal(t.telemetry(25, good).counted, true);
  assert.equal(t.state, 'Tagged');
  const r = t.telemetry(40, good);
  assert.equal(r.why, 'interval recorded');
  assert.equal(t.state, 'IntervalRecorded');
  assert.deepEqual(t.intervals, [{ from: 10, to: 40, fixes: [10, 25, 40] }]);
  // Three more make a second.
  for (const s of [55, 70, 85]) t.telemetry(s, good);
  assert.equal(t.intervals.length, 2);
});

test('only valid fixes count: in range, strong enough, distinct (spaced), and after tagging', () => {
  const t = new TagTrack();
  assert.equal(t.telemetry(1, good).why, 'not tagged');
  t.tag(0, { opportunity: true });
  assert.equal(t.telemetry(10, { inRange: false, signal: 1 }).why, 'out of receiver range');
  assert.equal(t.telemetry(11, { inRange: true, signal: 0.05 }).why, 'signal too weak');
  assert.equal(t.telemetry(12, good).counted, true);
  assert.equal(t.telemetry(14, good).why, 'too soon after the last fix');
  assert.equal(t.telemetry(12 + TAGGING.minSpacing, good).counted, true);
  assert.equal(t.intervals.length, 0, 'two counted fixes are not an interval yet');
  assert.equal(t.fixes.filter((f) => f.counted).length, 2);
});

test('a long gap breaks the observation: it is recorded, and the run starts again', () => {
  const t = new TagTrack();
  t.tag(0, { opportunity: true });
  t.telemetry(10, good); t.telemetry(25, good);
  const r = t.telemetry(25 + TAGGING.maxGap + 5, good);   // after the gap: counts, but as the first of a new run
  assert.equal(r.counted, true);
  assert.equal(r.run, 1);
  assert.equal(t.intervals.length, 0);
  assert.deepEqual(t.gaps, [{ from: 25, to: 90, seconds: 65 }]);
  t.telemetry(100, good); t.telemetry(115, good);
  assert.equal(t.intervals.length, 1);
  assert.deepEqual(t.intervals[0].fixes, [90, 100, 115]);
});

test('Recovered only by extracting with the records; only valid recovered intervals pay', () => {
  const lost = new TagTrack();
  lost.tag(0, { opportunity: true });
  for (const s of [10, 25, 40]) lost.telemetry(s, good);
  const r1 = lost.recover(50, { extracted: false });
  assert.equal(r1.ok, false);
  assert.equal(lost.payable, false);
  assert.notEqual(lost.state, 'Recovered');

  const kept = new TagTrack();
  kept.tag(0, { opportunity: true });
  for (const s of [10, 25, 40]) kept.telemetry(s, good);
  assert.equal(kept.recover(50, { extracted: true }).payable, true);
  assert.equal(kept.state, 'Recovered');
  assert.equal(kept.payable, true);
  assert.equal(kept.recover(60, { extracted: true }).duplicate, true, 'recovered once');
  assert.equal(kept.telemetry(70, good).why, 'already recovered');

  const thin = new TagTrack();
  thin.tag(0, { opportunity: true });
  thin.telemetry(10, good); thin.telemetry(25, good);
  const r3 = thin.recover(30, { extracted: true });
  assert.equal(r3.payable, false, 'no complete interval: recovered, but nothing valid to pay');
});

test('a silence right after an interval is still a visible gap', () => {
  const t = new TagTrack();
  t.tag(0, { opportunity: true });
  for (const s of [10, 25, 40]) t.telemetry(s, good);
  t.telemetry(70, { inRange: false });
  t.telemetry(120, { inRange: false });
  assert.deepEqual(t.gaps, [{ from: 40, to: 120, seconds: 80 }]);
  assert.equal(t.intervals.length, 1, 'the recorded interval stays valid');
});

test('the track round-trips through JSON (save/resume)', () => {
  const t = new TagTrack({ tagId: 'F16-2' });
  t.tag(0, { opportunity: true }); t.telemetry(10, good); t.telemetry(25, good);
  const back = TagTrack.fromJSON(JSON.parse(JSON.stringify(t)));
  back.telemetry(40, good);
  assert.equal(back.state, 'IntervalRecorded');
  assert.equal(back.tagId, 'F16-2');
});

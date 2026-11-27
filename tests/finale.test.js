import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordCommitment, recordFinaleOutcome, careerFinished, finaleRecord, COMMITMENT } from '../src/story/finale.js';

test('the warning is explicit: it says it may be irreversible and offers turning back', () => {
  assert.match(COMMITMENT.title, /no coming back/);
  assert.match(COMMITMENT.body.join(' '), /cannot be undone/);
  assert.equal(COMMITMENT.cancel, 'Turn back');
});

test('leaving before the commitment is an ordinary extraction: the case stays open', () => {
  const s = {};
  recordFinaleOutcome(s, { kind: 'extracted', attemptId: 'A1' });
  assert.equal(careerFinished(s), false);
  assert.equal(s.finale.extractions, 1);
  assert.equal(s.finale.disappeared, null);
});

test('the disappearance needs the commitment and is recorded as completion, not a death, with no payout', () => {
  const s = {};
  assert.throws(() => recordFinaleOutcome(s, { kind: 'disappeared' }), /commitment first/);
  recordCommitment(s, { attemptId: 'A2' });
  recordFinaleOutcome(s, { kind: 'disappeared', attemptId: 'A2' });
  assert.ok(careerFinished(s));
  assert.equal(s.finale.ordinaryDeaths, 0);
  assert.deepEqual(s.finale.disappeared, { attemptId: 'A2', at: 0, payout: 0 });
  assert.ok(s.finale.caseComplete);
});

test('an ordinary death, even after committing, is a retryable death: counted as a death, the story not finished', () => {
  const s = {};
  recordCommitment(s, { attemptId: 'A3' });
  recordFinaleOutcome(s, { kind: 'died', attemptId: 'A3' });
  assert.equal(careerFinished(s), false);
  assert.equal(s.finale.ordinaryDeaths, 1);
  assert.equal(s.finale.committed, false);                       // the next trip asks again
});

test('the record is a plain object that survives the save', () => {
  const s = {};
  recordCommitment(s, { attemptId: 'A4' }); recordFinaleOutcome(s, { kind: 'disappeared', attemptId: 'A4' });
  const back = JSON.parse(JSON.stringify(s));
  assert.ok(careerFinished(back));
  assert.deepEqual(finaleRecord(back).attempts.map((a) => a.event), ['committed', 'disappeared']);
});

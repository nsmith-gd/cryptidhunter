import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dreadFeedback, DREAD_FEEDBACK_AT } from '../src/hunt/dread.js';

test('no feedback and no label while dread does not affect you', () => {
  for (const v of [0, 10, DREAD_FEEDBACK_AT - 0.01]) {
    const f = dreadFeedback(v);
    assert.equal(f.on, false); assert.equal(f.label, null);
    assert.equal(f.tremor, 0); assert.equal(f.breath, 0); assert.equal(f.heart, 0);
  }
});

test('the label appears exactly when the tremor and breathing do (the UI never lies)', () => {
  for (let v = 0; v <= 100; v += 0.5) {
    const f = dreadFeedback(v);
    assert.equal(!!f.label, f.tremor > 0, `tremor at ${v}`);
    assert.equal(!!f.label, f.breath > 0, `breath at ${v}`);
    assert.equal(!!f.label, f.heart > 0, `heart at ${v}`);
  }
});

test('the label names what is happening, and gets stronger as dread does', () => {
  assert.match(dreadFeedback(40).label, /^Shaken: hands unsteady, breathing loud$/);
  assert.match(dreadFeedback(90).label, /^Badly shaken/);
  assert.ok(dreadFeedback(90).tremor > dreadFeedback(40).tremor);
  assert.ok(dreadFeedback(90).breath > dreadFeedback(40).breath);
  assert.equal(dreadFeedback(100).tremor, 1);
});

test('never a number or a meter in the label (no sanity or panic meter)', () => {
  for (let v = 0; v <= 100; v += 5) {
    const l = dreadFeedback(v).label ?? '';
    assert.doesNotMatch(l, /\d|%|sanity|panic|meter/i);
  }
});

// Photo evidence capture (#85): quality components, light, previews and the archive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { qualityScore, creatureQuality, clueQuality, lightAt, photoRecord, advance, EvidenceArchive, PHOTO_EVIDENCE } from '../src/evidence/photoEvidence.js';

test('GDD 4.5 quality formula: Q = round(100 x (0.30C + 0.35I + 0.20K + 0.15P) x integrity)', () => {
  assert.equal(qualityScore({ C: 1, I: 1, K: 1, P: 1 }), 100);
  assert.equal(qualityScore({ C: 0.5, I: 0.5, K: 0.5, P: 0.5 }), 50);
  assert.equal(qualityScore({ C: 1, I: 0, K: 0, P: 0 }), 30);
  assert.equal(qualityScore({ C: 1, I: 1, K: 1, P: 1 }, 0.5), 50);
});

const goodShot = { visible: 6, samples: 6, screenSize: 0.4, distance: 10, headVisible: true };

test('a well-lit, steady, whole, close creature photo scores high and has no problems', () => {
  const q = creatureQuality({ shot: goodShot, light: 0.9, steadiness: 1 });
  assert.ok(q.Q >= 85, `Q ${q.Q}`);
  assert.deepEqual(q.problems, []);
});

test('each real problem lowers its own component and is named in the preview', () => {
  const base = creatureQuality({ shot: goodShot, light: 0.9, steadiness: 1 });
  const dark = creatureQuality({ shot: goodShot, light: 0.1, steadiness: 1 });
  assert.ok(dark.C < base.C && dark.I < base.I && dark.K === base.K && dark.Q < base.Q - 25);   // too dark to make out features
  assert.match(dark.problems.join(), /Too dark/);
  const blur = creatureQuality({ shot: goodShot, light: 0.9, steadiness: 0.4 });
  assert.ok(blur.C < base.C); assert.match(blur.problems.join(), /Blurred/);
  const hidden = creatureQuality({ shot: { ...goodShot, visible: 2 }, light: 0.9, steadiness: 1 });
  assert.ok(hidden.K < base.K); assert.match(hidden.problems.join(), /hidden or cut off/);
  const noHead = creatureQuality({ shot: { ...goodShot, headVisible: false }, light: 0.9, steadiness: 1 });
  assert.ok(noHead.I < base.I); assert.match(noHead.problems.join(), /Head not in the shot/);
  const tiny = creatureQuality({ shot: { ...goodShot, screenSize: 0.05, distance: 40 }, light: 0.9, steadiness: 1 });
  assert.ok(tiny.I < base.I); assert.match(tiny.problems.join(), /Too small/);
});

test('clue photos: close and from above beat far and low', () => {
  const close = clueQuality({ view: { inFrame: 1, unobstructed: 1, distance: 2, downAngle: 1.1 }, light: 0.9, steadiness: 1 });
  const far = clueQuality({ view: { inFrame: 1, unobstructed: 1, distance: 6.5, downAngle: 0.2 }, light: 0.9, steadiness: 1 });
  assert.ok(close.Q > far.Q + 20, `${close.Q} vs ${far.Q}`);
  assert.deepEqual(close.problems, []);
  assert.match(far.problems.join(), /Too far/); assert.match(far.problems.join(), /from above/);
});

test('light on the subject comes from game light sources, not the render', () => {
  const scene = new THREE.Scene();
  const p = new THREE.Vector3(0, 1, -8);
  const ambientOnly = lightAt(scene, p, { ambient: 0.05 });
  assert.ok(ambientOnly < PHOTO_EVIDENCE.darkBelow, `ambient night ${ambientOnly}`);
  const torch = new THREE.SpotLight(0xffffff, 14, 30, THREE.MathUtils.degToRad(24), 0.45, 1.6);
  torch.position.set(0, 1.6, 0); torch.target.position.set(0, 1, -10);
  scene.add(torch, torch.target); scene.updateMatrixWorld(true);
  const lit = lightAt(scene, p, { ambient: 0.05 });
  assert.ok(lit > 0.6, `torch at 8 m ${lit}`);
  const offAxis = lightAt(scene, new THREE.Vector3(8, 1, -2), { ambient: 0.05 });
  assert.ok(offAxis < lit - 0.3, 'outside the beam is dark');
  torch.visible = false;
  assert.ok(lightAt(scene, p, { ambient: 0.05, nightVision: true }) >= PHOTO_EVIDENCE.nightVisionFloor, 'night vision makes it readable');
  scene.add(new THREE.DirectionalLight(0xffffff, 5));                   // presentation light: ignored
  assert.equal(lightAt(scene, p, { ambient: 0.05 }), ambientOnly);
});

test('records follow the lifecycle and the archive keeps each record once', () => {
  const q = creatureQuality({ shot: goodShot, light: 0.9, steadiness: 1 });
  const r = photoRecord({ id: 'A1-F1', kind: 'creature', source: { kind: 'creature', id: 'bigfoot', actual: 'Bigfoot' }, eventId: 'sighting:bigfoot:30',
    attemptId: 'A1', time: 30, location: { x: 1, z: 2 }, frame: 1, quality: q });
  assert.equal(r.type, 'EV03'); assert.equal(r.state, 'secured');
  advance([r], 'extracted', 400);
  assert.deepEqual(r.history.map((h) => h.state), ['secured', 'extracted']);
  let store = {};
  const save = { load: () => store, save: (o) => { store = JSON.parse(JSON.stringify(o)); } };
  const a = new EvidenceArchive(save);
  a.add([r]); a.add([r]);
  assert.equal(a.records.length, 1);
  assert.equal(new EvidenceArchive(save).records.length, 1, 'persisted in the save');
});

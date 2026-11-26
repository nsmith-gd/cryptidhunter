import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, rebind, remapTable, keyFor, DEFAULT_SETTINGS, Settings } from '../src/settings/settings.js';
import { SaveService, memoryBackend } from '../src/save/saveService.js';

test('bad or missing settings fall back to defaults and are clamped', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS, bindings: {} });
  const s = normalizeSettings({ fov: 400, brightness: 'x', invertY: 'yes', captions: false, bindings: { flashlight: 7 } });
  assert.equal(s.fov, 100);
  assert.equal(s.brightness, 1);
  assert.equal(s.invertY, false);
  assert.equal(s.captions, false);
  assert.deepEqual(s.bindings, {});
});

test('rebinding to a key in use swaps the two actions', () => {
  let s = normalizeSettings({});
  s = rebind(s, 'flashlight', 'KeyE');          // E was examine
  assert.equal(keyFor(s, 'flashlight'), 'KeyE');
  assert.equal(keyFor(s, 'examine'), 'KeyF');
  const t = remapTable(s);
  assert.equal(t.get('KeyE'), 'KeyF');          // pressing E now does what F did (flashlight)
  assert.equal(t.get('KeyF'), 'KeyE');
});

test('a freed default key no longer triggers its old action', () => {
  const s = rebind(normalizeSettings({}), 'flashlight', 'KeyX');
  const t = remapTable(s);
  assert.equal(t.get('KeyX'), 'KeyF');
  assert.equal(t.get('KeyF'), null);
});

test('rebinding back to the default stores nothing', () => {
  const s = rebind(rebind(normalizeSettings({}), 'flashlight', 'KeyX'), 'flashlight', 'KeyF');
  assert.deepEqual(s.bindings, {});
  assert.equal(remapTable(s).size, 0);
});

test('settings are saved in the save file alongside money, and read back', () => {
  const backend = memoryBackend();
  const svc = new SaveService(backend);
  svc.save({ money: 120 });
  const a = new Settings(svc);
  a.set({ fov: 88, reducedShake: true });
  const doc = svc.load();
  assert.equal(doc.money, 120);
  assert.equal(doc.settings.fov, 88);
  assert.equal(new Settings(svc).get('reducedShake'), true);
});

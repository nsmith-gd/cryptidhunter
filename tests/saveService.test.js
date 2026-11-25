import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveService, memoryBackend, SAVE_VERSION } from '../src/save/saveService.js';
import { fileBackend } from '../src/save/fileBackend.js';
import { Camp } from '../src/hunt/camp.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ch-save-'));

test('money round-trips through the JSON save file across a restart', () => {
  const dir = tmp(), file = join(dir, 'save.json');
  new SaveService(fileBackend(file)).save({ money: 1234 });
  const restarted = new SaveService(fileBackend(file));   // fresh instance = new session
  assert.equal(restarted.load().money, 1234);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: SAVE_VERSION, money: 1234 });
  assert.equal(existsSync(`${file}.tmp`), false, 'atomic write leaves no temp file');
  rmSync(dir, { recursive: true });
});

test('missing save file loads defaults (money 0)', () => {
  const dir = tmp();
  assert.deepEqual(new SaveService(fileBackend(join(dir, 'nope.json'))).load(), { version: SAVE_VERSION, money: 0 });
  rmSync(dir, { recursive: true });
});

test('corrupt or nonsense save files load defaults without throwing', () => {
  const dir = tmp(), file = join(dir, 'save.json');
  for (const junk of ['{"money": 12', 'not json at all', '[]', 'null', '{"money": "lots"}', '{"money": -50}']) {
    writeFileSync(file, junk);
    assert.equal(new SaveService(fileBackend(file)).load().money, 0, `for ${junk}`);
  }
  rmSync(dir, { recursive: true });
});

test('base camp money persists through the save service', () => {
  const backend = memoryBackend();
  const a = new Camp(null, new SaveService(backend));
  a.state.money = 777; a.save();
  const b = new Camp(null, new SaveService(backend));   // restart
  assert.equal(b.state.money, 777);
  assert.equal(JSON.parse(backend.read()).money, 777);
});

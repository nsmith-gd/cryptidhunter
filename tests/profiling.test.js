import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfilingRecorder, validateBundle, percentile, token, STALL_MS } from '../src/profiling/recorder.js';

const fake = () => { let t = 0, tick = 0; return { clock: { now: () => t, advance: (ms) => { t += ms; tick += Math.round(ms / (1000 / 60)); } }, tick: () => tick }; };
const make = (o = {}) => { const f = fake(); const r = new ProfilingRecorder({ build: 'dev 1.2', gym: 'G00', scenario: 'Pine Hollow!', platform: 'desktop', seed: 42, runId: 'Run#1',
  now: f.clock.now, utc: () => new Date('2026-11-26T10:00:00Z'), getTick: f.tick, ...o }); return { r, f }; };

test('percentiles (nearest rank)', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50); assert.equal(percentile(v, 95), 95); assert.equal(percentile(v, 99), 99);
  assert.equal(percentile([], 95), null);
});

test('records frame times, p95 and stalls over 100 ms; ignores paused segments', () => {
  const { r, f } = make();
  r.start();
  for (let i = 0; i < 95; i++) { f.clock.advance(16); r.frame(16.7, 5); }
  for (let i = 0; i < 4; i++) { f.clock.advance(30); r.frame(30, 9); }
  f.clock.advance(150); r.frame(150, 140);            // one stall
  r.setSegment('paused', 'tab');
  r.frame(5000);                                     // a pause is not a stall
  r.setSegment('active');
  const m = r.summary().metrics;
  assert.equal(m.frame_interval_ms.count, 100);
  assert.equal(m.frame_interval_ms.p95, 16.7);
  assert.equal(m.frame_interval_ms.p99, 30);
  assert.equal(m.frame_interval_ms.max, 150);
  assert.equal(m.stalls_over_100ms.count, 1);
  assert.equal(m.cpu_app_ms.status, 'measured');
  assert.equal(m.gpu_ms.status, 'unsupported');
  assert.ok(STALL_MS === 100);
});

test('evidence and economy events are counted with ids, time and tick', () => {
  const { r, f } = make();
  r.start();
  f.clock.advance(1000);
  r.event('photo_taken', { system_id: 'P07', data: { subject: 'Bigfoot', score: 72 } });
  r.event('clue_logged', { system_id: 'P07', data: { type: 'footprint' } });
  r.event('evidence_sold', { system_id: 'P08', correlation_id: 'hunt-1', data: { earned: 932 } });
  r.event('bounty_paid', { system_id: 'P08', correlation_id: 'hunt-1', data: { id: 'bigfoot-70', bonus: 500 } });
  const s = r.summary();
  assert.deepEqual(s.totals.evidence, { photos_taken: 1, photos_hit: 1, best_photo_score: 72, clues_logged: 1 });
  assert.equal(s.totals.economy.revenue, 932);
  assert.equal(s.totals.economy.bounties_paid, 1);
  const e = r.events.find((x) => x.type === 'photo_taken');
  assert.equal(e.t_ms, 1000); assert.equal(e.tick, 60); assert.match(e.event_id, /^e\d+$/);
});

test('export: three files named per the contract, all valid JSON / JSONL, counts agree', () => {
  const { r, f } = make();
  r.start();
  for (let i = 0; i < 10; i++) { f.clock.advance(16); r.frame(16, 4); }
  r.event('photo_taken', { data: { subject: null, score: 0 } });
  r.stop();
  const b = r.exportBundle();
  assert.equal(b.baseName, 'cryptozoology_dev-1-2_g00_pine-hollow_desktop_42_run-1');
  assert.deepEqual(Object.keys(b.files).sort(), ['events.jsonl', 'manifest.json', 'summary.json']);
  assert.deepEqual(validateBundle(b.files), []);
  const lines = b.files['events.jsonl'].trim().split('\n');
  assert.equal(JSON.parse(b.files['manifest.json']).files.find((x) => x.role === 'events.jsonl').records, lines.length);
  assert.equal(JSON.parse(b.files['summary.json']).started_utc, '2026-11-26T10:00:00.000Z');
});

test('validator catches broken exports', () => {
  const { r, f } = make();
  r.start(); f.clock.advance(16); r.frame(16); r.event('x'); r.stop();
  const b = r.exportBundle().files;
  assert.ok(validateBundle({ ...b, 'summary.json': '{"broken": ' }).length > 0);
  assert.ok(validateBundle({ ...b, 'events.jsonl': b['events.jsonl'] + 'not json\n' }).length > 0);
  assert.ok(validateBundle({ ...b, 'events.jsonl': '' }).some((e) => /manifest says/.test(e)));
});

test('bounded buffers: event overflow is counted, never silently passed', () => {
  const { r } = make({ maxEvents: 5 });
  r.start();
  for (let i = 0; i < 20; i++) r.event('noise');
  const s = r.summary();
  assert.ok(s.capture.dropped_events > 0);
  assert.equal(s.capture.complete, false);
});

test('tokens are sanitized', () => { assert.equal(token('Pine Hollow / Night #2'), 'pine-hollow-night-2'); assert.equal(token(''), 'na'); });

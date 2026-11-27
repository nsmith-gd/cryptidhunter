import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HodagProxy, HODAG, sightBlocked } from '../src/cryptids/hodag.js';

const DT = 1 / 60;
const territory = { home: { x: 0, z: 0 }, warnR: 15, coreR: 7 };
const silent = { log: [], play(kind, o) { this.log.push({ kind, ...o }); } };
const mk = (opts = {}) => {
  const events = [], captions = [];
  const audio = { log: [], play(kind, o) { this.log.push({ kind, t: o.t }); } };
  const h = new HodagProxy({ territory, trace: (sys, type, data) => events.push({ type, ...data }), captions: { say: (t) => captions.push(t) }, audio, ...opts });
  return { h, events, captions, audio };
};
const mkPlayer = (x, z) => ({ position: { x, z }, yaw: 0 });
const mkHealth = () => ({ value: 100, hits: 0, injure(e) { this.value -= e.damage; this.hits++; return { damage: e.damage, healthAfter: this.value }; } });
const moveToward = (p, x, z, speed) => { const dx = x - p.position.x, dz = z - p.position.z, d = Math.hypot(dx, dz); if (d > 1e-6) { const s = Math.min(d, speed * DT); p.position.x += dx / d * s; p.position.z += dz / d * s; } };

test('the sequence: warn (growl, captioned) -> charge (roar) after the warning -> hit -> disengage (snort) -> home', () => {
  const { h, events, captions, audio } = mk();
  const p = mkPlayer(0, 12), hp = mkHealth();
  for (let i = 0; i < 60 * 12; i++) h.update(DT, { player: p, health: hp });
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 3), ['warn', 'charge', 'hit']);
  assert.ok(types.includes('disengage') && types.at(-1) === 'idle');
  assert.ok(events.find((e) => e.type === 'charge').lead >= HODAG.warnHold);
  const kinds = audio.log.map((s) => s.kind);
  assert.ok(kinds.indexOf('growl') < kinds.indexOf('roar') && kinds.includes('thud') && kinds.includes('snort'));
  assert.ok(audio.log.filter((s) => s.kind === 'growl').length >= 2, 'it keeps growling while it warns');
  assert.ok(captions.some((c) => /growl/.test(c)) && captions.some((c) => /roar/.test(c)), 'sounds are captioned');
  assert.equal(hp.hits, 1);
});

test('heeding the warning: step back past the boundary and it settles without charging', () => {
  const { h, events } = mk();
  const p = mkPlayer(0, 13), hp = mkHealth();
  for (let i = 0; i < 60; i++) h.update(DT, { player: p, health: hp });
  assert.equal(h.state, 'warn');
  for (let i = 0; i < 60 * 3; i++) { moveToward(p, 0, 30, 3.2); h.update(DT, { player: p, health: hp }); }
  assert.equal(h.state, 'idle');
  assert.equal(events.find((e) => e.type === 'idle').why, 'warning heeded');
  assert.ok(!events.some((e) => e.type === 'charge'));
});

test('running into the core still gets at least the minimum warning', () => {
  const { h, events } = mk();
  const p = mkPlayer(0, 14.5), hp = mkHealth();
  for (let i = 0; i < 60 * 5 && !events.some((e) => e.type === 'charge'); i++) { moveToward(p, 0, 0, 6); h.update(DT, { player: p, health: hp }); }
  assert.ok(events.find((e) => e.type === 'charge').lead >= HODAG.minLead);
});

test('a missed charge becomes a short pursuit; a sprinter outruns it and it gives up or stops at the boundary', () => {
  const { h, events } = mk({ territory: { ...territory, warnR: 80, coreR: 7 } });   // a huge ground, so it can't be the boundary
  const p = mkPlayer(0, 20), hp = mkHealth();
  for (let i = 0; i < 60 * 4.2; i++) h.update(DT, { player: p, health: hp });
  assert.equal(h.state, 'charge');
  for (let i = 0; i < 60 * 12; i++) { moveToward(p, 0, 200, 6.0); h.update(DT, { player: p, health: hp }); }
  const types = events.map((e) => e.type);
  assert.ok(types.includes('pursuit'));
  assert.equal(events.find((e) => e.type === 'disengage').why, 'gave up');
  assert.equal(hp.hits, 0);
});

test('leaving the zone ends the pursuit every time (48 escapes in every direction, walking and sprinting)', () => {
  let trials = 0;
  for (let a = 0; a < 24; a++) {
    for (const speed of [3.2, 6.0]) {
      const { h, events } = mk({ cfg: { damage: 0, contact: 0 } });          // no contact: test the chase rule alone
      const ang = (a / 24) * Math.PI * 2, p = mkPlayer(Math.cos(ang) * 10, Math.sin(ang) * 10), hp = mkHealth();
      for (let i = 0; i < 60 * 6 && h.state !== 'charge'; i++) h.update(DT, { player: p, health: hp });
      assert.equal(h.state, 'charge', `trial ${a}: it charged`);
      // Flee straight out, with a sideways jink, until well past the boundary.
      const out = ang + (a % 3 - 1) * 0.5;
      let crossedAt = null, maxR = 0;
      for (let i = 0; i < 60 * 20; i++) {
        moveToward(p, Math.cos(out) * 200, Math.sin(out) * 200, speed);
        h.update(DT, { player: p, health: hp });
        maxR = Math.max(maxR, Math.hypot(h.pos.x, h.pos.z));
        const r = Math.hypot(p.position.x, p.position.z);
        if (crossedAt === null && r > h.T.boundaryR) crossedAt = i;
        if (crossedAt !== null && i > crossedAt) assert.ok(!['charge', 'pursuit'].includes(h.state), `trial ${a} (${speed} m/s): still chasing past the boundary`);
      }
      assert.ok(crossedAt !== null);
      assert.ok(maxR <= h.T.boundaryR, `it never crosses its own boundary (${maxR.toFixed(2)})`);
      assert.ok(events.some((e) => e.type === 'disengage'));
      trials++;
    }
  }
  assert.equal(trials, 48);
});

test('cover breaks its line of sight mid-charge: it pulls up, searches, goes home', () => {
  const cover = [{ x0: -6, z0: 4, x1: 6, z1: 5 }];
  assert.ok(sightBlocked(0, 0, 0, 8, cover));
  assert.ok(!sightBlocked(0, 0, 10, 6, cover));
  const { h, events } = mk({ cover, cfg: { loseSight: 0.5 } });
  const p = mkPlayer(10, 6), hp = mkHealth();                                 // in view, off to the side
  for (let i = 0; i < 60 * 6 && h.state !== 'charge'; i++) h.update(DT, { player: p, health: hp });
  p.position.x = 0; p.position.z = 7;                                         // duck behind the cover
  for (let i = 0; i < 60 * 8; i++) h.update(DT, { player: p, health: hp });
  assert.ok(events.some((e) => e.type === 'lost-sight'));
  assert.ok(events.some((e) => e.type === 'disengage' && e.why === 'lost sight'));
});

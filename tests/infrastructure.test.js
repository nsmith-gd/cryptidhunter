import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InfrastructureSite, graftonSite } from '../src/infrastructure/infrastructure.js';

test('damage hits only the asset struck; nothing unconnected changes', () => {
  const s = graftonSite();
  const before = Object.fromEntries([...s.assets].map(([k, a]) => [k, a.integrity]));
  const r = s.damage('shelter', 30, 'creature');
  assert.equal(r.affected.length, 0);
  for (const [k, v] of Object.entries(before)) if (k !== 'shelter') assert.equal(s.asset(k).integrity, v);
  assert.equal(s.asset('shelter').integrity, 70);
});

test('a broken power source takes down only what draws power through it', () => {
  const s = graftonSite();
  const r = s.damage('generator', 100, 'creature');
  assert.ok(r.broke);
  assert.deepEqual(r.affected.sort(), ['lights', 'winch']);
  assert.ok(s.working('footbridge') && s.working('bridge') && s.working('pad'));
  assert.equal(s.vibrationSources().length, 0);                       // the machine stopped
});

test('integrity: a warning below 40, broken at 0; repair brings it back', () => {
  const s = graftonSite();
  s.damage('bridge', 65);
  assert.ok(s.trace.some((e) => e.type === 'warning' && e.asset === 'bridge'));
  s.damage('bridge', 40);
  assert.ok(s.broken('bridge'));
  assert.match(s.routeOpen('cargo', 500).why, /cargo bridge is broken/);
  s.repair('bridge');
  assert.ok(s.routeOpen('cargo', 500).open);
});

test('cargo capacity: a load over a structure\'s limit is refused, with the reason', () => {
  const s = graftonSite();
  s.setRunning('winch', true);
  assert.ok(s.routeOpen('cargo', 1800).open);
  assert.match(s.routeOpen('cargo', 2200).why, /winch can't take 2200 kg/);
});

test('a blocked or failed cargo route never blocks the foot exit', () => {
  const s = graftonSite();
  s.block('cargo', 'the floodplain is under water');
  assert.equal(s.routeOpen('cargo').open, false);
  s.damage('bridge', 100); s.damage('pad', 100); s.damage('winch', 100); s.damage('generator', 100);
  assert.deepEqual(s.footExits(), ['foot']);
  assert.ok(s.routeOpen('foot').open);
});

test('a site where the foot exit depends on a cargo-only asset is rejected when it is built', () => {
  assert.throws(() => new InfrastructureSite({ assets: [{ id: 'bridge', cargoOnly: true }], routes: [{ id: 'walk', kind: 'foot', via: ['bridge'] }] }), /foot route walk depends on cargo-only bridge/);
});

test('machinery: only intact, running machines vibrate; a broken or unpowered one can\'t be started', () => {
  const s = graftonSite();
  assert.deepEqual(s.vibrationSources().map((v) => v.id), ['generator']);
  s.setRunning('winch', true);
  assert.deepEqual(s.vibrationSources().map((v) => v.id).sort(), ['generator', 'winch']);
  s.damage('generator', 100);
  assert.equal(s.setRunning('winch', true), false);
  assert.deepEqual(s.vibrationSources(), []);
});

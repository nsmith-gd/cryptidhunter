import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Aquatic, AQUA } from '../src/water/aquatic.js';
import { Boat, BOAT } from '../src/water/boat.js';
import { TIMI, surfaceAt, boatWater, shoreTrail, trailRouteHome, nearestTrail, inWater } from '../src/maps/timiskamingLayout.js';

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
const mkPlayer = (x, z) => ({ position: vec(x, 0, z), velocity: vec(), stamina: 1, crouching: false });
const mkHealth = () => ({ value: 100, causes: [], exposure(cause, rate, dt, active) { if (active) { this.value -= rate * dt; this.causes.push(cause); } } });
const step = (fn, secs, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) fn(dt); };

test('lake layout: deep middle, shallow rim, dry dock and shore', () => {
  assert.equal(surfaceAt(0, -30), 'deep');
  assert.equal(surfaceAt(6, 2), 'shallow');          // just inside the south waterline (z=4)
  assert.equal(surfaceAt(0, 20), 'dry');
  assert.equal(surfaceAt(0, 0), 'dry');               // on the dock
  assert.equal(surfaceAt(0, -30, 0.35), 'dry');       // sitting in a boat
  assert.equal(surfaceAt(-32, -72), 'deep');          // north bay
  assert.ok(boatWater(TIMI.mooring.x, TIMI.mooring.z), 'the boat is moored on floatable water');
});

test('the shore trail is dry all the way round and leads home from any bay', () => {
  const trail = shoreTrail();
  for (const p of trail) assert.equal(surfaceAt(p.x, p.z), 'dry', `trail point ${p.x},${p.z} is dry`);
  for (let i = 0; i < trail.length; i++) {           // no leg of the loop cuts across water
    const a = trail[i], b = trail[(i + 1) % trail.length];
    for (let k = 0; k <= 10; k++) assert.ok(!inWater(a.x + (b.x - a.x) * k / 10, a.z + (b.z - a.z) * k / 10), `leg ${i} stays dry`);
  }
  const north = nearestTrail(trail, -32, -92);
  const route = trailRouteHome(trail, north.i);
  const end = route.at(-1);
  assert.ok(Math.hypot(end.x - TIMI.start.x, end.z - TIMI.start.z) < 20, 'the route ends at the hub');
});

test('breath exists only under water: swimming at the surface does not drain it', () => {
  const p = mkPlayer(0, -30), h = mkHealth();
  const a = new Aquatic({ player: p, surfaceAt, health: h });
  step((dt) => a.update(dt), 5);
  assert.equal(a.mode, 'swimming');
  assert.equal(a.breath, AQUA.breathMax);
  assert.equal(a.showBreath, false);
  p.crouching = true;                                 // dive
  step((dt) => a.update(dt), 5);
  assert.equal(a.mode, 'under');
  assert.ok(a.showBreath);
  assert.ok(a.breath < AQUA.breathMax - 15);
  p.crouching = false;
  step((dt) => a.update(dt), 3);
  assert.equal(a.mode, 'swimming');
  assert.equal(a.breath, AQUA.breathMax, 'surfacing refills it');
  assert.equal(h.value, 100);
});

test('out of breath under water: drowning goes through health, and stops when you surface', () => {
  const p = mkPlayer(0, -30), h = mkHealth();
  const a = new Aquatic({ player: p, surfaceAt, health: h });
  p.crouching = true;
  step((dt) => a.update(dt), 30);
  assert.ok(a.drowning);
  assert.ok(h.value < 100 && h.causes.every((c) => c === 'Drowning'));
  const hv = h.value; p.crouching = false;
  step((dt) => a.update(dt), 2);
  assert.ok(!a.drowning);
  assert.ok(Math.abs(h.value - hv) < AQUA.drownDamage * 0.05);
});

test('exhausted with no flotation vest you slip under; with one you stay up', () => {
  for (const pfd of [false, true]) {
    const p = mkPlayer(0, -30), h = mkHealth();
    const a = new Aquatic({ player: p, surfaceAt, health: h, hasPfd: () => pfd });
    p.velocity.x = 1;                                  // stroking
    let wentUnder = false;
    step((dt) => { a.update(dt); if (a.mode === 'under') wentUnder = true; }, 45);
    assert.equal(wentUnder, !pfd, pfd ? 'the vest keeps your head up' : 'you slip under');
  }
});

test('boat: board in reach, burn fuel under power, leave onto the dock or over the side', () => {
  const p = mkPlayer(TIMI.mooring.x - 1, TIMI.mooring.z + 3);
  const tank = { fuel: 1 };
  const b = new Boat({ x: TIMI.mooring.x, z: TIMI.mooring.z, isWater: boatWater, footingAt: surfaceAt, tank });
  assert.equal(b.leave(p), null);
  assert.ok(b.board(p));
  assert.equal(b.leave(p), 'stepped ashore');        // the dock is right there
  assert.equal(surfaceAt(p.position.x, p.position.z), 'dry');
  p.position.set(b.x, 0, b.z + 2); assert.ok(b.board(p));
  b.setEngine(true);
  const keys = new Set(['KeyW']);
  step((dt) => b.update(dt, { keys, player: p }), 6);
  assert.ok(tank.fuel < 1 && tank.fuel > 0.9);
  assert.ok(b.z < TIMI.mooring.z - 10, 'it went out onto the lake');
  assert.equal(p.position.y, BOAT.seat);
  assert.equal(b.leave(p), 'over the side');
  assert.equal(surfaceAt(p.position.x, p.position.z, p.position.y), 'deep');
});

test('boat: a hard turn at full speed heels it but holds in calm water; a bump on top capsizes it', () => {
  const p = mkPlayer(0, -28);
  const b = new Boat({ x: 0, z: -30, isWater: (x, z) => inWater(x, z, 1.5), footingAt: surfaceAt });
  b.board(p); b.setEngine(true);
  const keys = new Set(['KeyW', 'KeyA']);
  let maxHeel = 0;
  step((dt) => { b.update(dt, { keys, player: p }); maxHeel = Math.max(maxHeel, b.heel); }, 10);
  assert.equal(b.state, 'aboard');
  assert.ok(maxHeel > 0.7 && maxHeel < BOAT.capsizeAt, `heels hard (${maxHeel.toFixed(2)}) without going over`);
  b.bump(1);
  b.update(1 / 60, { keys, player: p });
  assert.equal(b.state, 'capsized');
  assert.equal(surfaceAt(p.position.x, p.position.z, p.position.y), 'deep', 'you are in the water');
  assert.equal(b.board(p), false, 'you cannot climb into an upturned hull');
  step((dt) => b.update(dt, { player: p, holdUse: true }), BOAT.rightTime + 0.2);
  assert.equal(b.state, 'adrift', 'held E beside it: righted');
  assert.ok(b.board(p));
});

test('boat: storm waves capsize a boat turning hard at speed', () => {
  const p = mkPlayer(0, -28);
  const b = new Boat({ x: 0, z: -30, isWater: (x, z) => inWater(x, z, 1.5), footingAt: surfaceAt, storm: () => 1 });
  b.board(p); b.setEngine(true);
  const keys = new Set(['KeyW', 'KeyA']);
  step((dt) => b.update(dt, { keys, player: p }), 30);
  assert.equal(b.state, 'capsized');
});

test('boat: out of fuel the engine dies and you can only paddle', () => {
  const p = mkPlayer(0, -28);
  const tank = { fuel: 0.001 };
  const b = new Boat({ x: 0, z: -30, isWater: (x, z) => inWater(x, z, 1.5), footingAt: surfaceAt, tank });
  b.board(p); b.setEngine(true);
  step((dt) => b.update(dt, { keys: new Set(['KeyW']), player: p }), 4);
  assert.equal(b.engine, false);
  assert.equal(b.vibration, 0);
  assert.ok(Math.abs(b.speed - BOAT.paddle) < 0.01);
  assert.equal(b.setEngine(true), false);
});

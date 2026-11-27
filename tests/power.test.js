import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PowerBudget } from '../src/power/powerBudget.js';

const kit = () => {
  const events = [], notes = [];
  const b = new PowerBudget({ trace: (type, d) => events.push({ type, ...d }), notify: (m) => notes.push(m) });
  b.addPack('boat', { name: 'boat battery', capacity: 10 }).addPack('bank', { name: 'power bank', capacity: 10 })
    .addPack('spare1', { name: 'spare pack 1', capacity: 5, spare: true });
  b.addDevice('sonar', { name: 'sonar', pack: 'boat' }).addDevice('lantern', { name: 'lantern', pack: 'boat', drawPerSec: 1 })
    .addDevice('gps', { name: 'GPS', pack: 'bank', drawPerSec: 0.5 });
  b.addTank('outboard', { name: 'outboard tank', litres: 2, capacity: 12 }).addTank('can', { name: 'fuel can', litres: 5, capacity: 5 })
    .addTank('stove', { name: 'stove canister', litres: 1, capacity: 1, type: 'gas' }).addTank('gen', { name: 'generator tank', litres: 1, capacity: 3 });
  b.addGenerator('g', { name: 'generator', tank: 'gen', litresPerSec: 0.1, chargePerSec: 2 });
  return { b, events, notes };
};
const run = (b, secs, dt = 0.1) => { for (let t = 0; t < secs - 1e-9; t += dt) b.update(dt); };

test('a one-shot draw takes charge once; continuous draws only while on', () => {
  const { b } = kit();
  assert.ok(b.draw('sonar', 3));
  assert.equal(b.pack('boat').charge, 7);
  run(b, 2);
  assert.equal(b.pack('boat').charge, 7, 'the lantern is off: nothing drawn');
  b.setDevice('lantern', true); run(b, 2);
  assert.ok(Math.abs(b.pack('boat').charge - 5) < 1e-9);
});

test('a flat pack switches off only the devices wired to it', () => {
  const { b, events, notes } = kit();
  b.setDevice('lantern', true); b.setDevice('gps', true);
  run(b, 11);
  assert.ok(b.pack('boat').flat);
  assert.equal(b.isOn('lantern'), false);
  assert.equal(b.available('sonar'), false);
  assert.equal(b.draw('sonar', 1), false);
  assert.equal(b.isOn('gps'), true, 'the GPS is on another pack and keeps working');
  const flat = events.filter((e) => e.type === 'pack-flat');
  assert.equal(flat.length, 1, 'traced once');
  assert.deepEqual(flat[0].devices, ['sonar', 'lantern']);
  assert.ok(notes.some((n) => /boat battery is flat: sonar, lantern are off/.test(n)));
  assert.equal(b.setDevice('lantern', true).ok, false);
});

test('swap a flat pack\'s devices to a spare: they come back on; the spare then drains', () => {
  const { b } = kit();
  b.setDevice('lantern', true); run(b, 11);
  assert.equal(b.swapFlatToSpare(), 'spare1');
  assert.equal(b.device('lantern').pack, 'spare1');
  assert.ok(b.isOn('lantern'), 'it was left switched on, so it lights again');
  run(b, 2);
  assert.ok(Math.abs(b.pack('spare1').charge - 3) < 1e-9);
  run(b, 4);
  assert.equal(b.swapFlatToSpare(), null, 'no spares left');
});

test('fuel: tank view as a fraction, pour only between the same fuel, generator burns its own tank to charge', () => {
  const { b, events } = kit();
  const view = b.tankView('outboard');
  assert.ok(Math.abs(view.fuel - 2 / 12) < 1e-9);
  view.fuel = 0;
  assert.ok(events.some((e) => e.type === 'tank-empty' && e.tank === 'outboard'));
  assert.equal(b.pour('stove', 'outboard'), 0, 'stove gas does not go in the outboard');
  assert.equal(b.pour('can', 'outboard'), 5);
  assert.equal(b.tank('outboard').litres, 5);
  b.setDevice('lantern', true); run(b, 10);
  assert.ok(b.pack('boat').flat);
  b.plug('boat', 'g'); assert.ok(b.setGenerator('g', true));
  run(b, 3);
  assert.ok(!b.pack('boat').flat && b.pack('boat').charge > 0, 'charging brings it back');
  assert.ok(Math.abs(b.tank('gen').litres - 0.7) < 1e-6);
  assert.equal(b.tank('outboard').litres, 5, 'the generator never touches the boat\'s fuel');
  run(b, 10);
  assert.equal(b.generators.get('g').running, false, 'out of fuel, it stops');
  assert.equal(b.setGenerator('g', true), false);
});

import * as THREE from 'three';
import { PowerBudget } from './powerBudget.js';
import { PowerHud } from './powerHud.js';

// The L05 power and fuel kit (GDD 1.5 L05, 3.2 C07/C08/E01–E04/F10–F12; task #140), on the shared
// S12 budget. Two packs share the load and fail separately:
//   boat battery (12 V)   portable sonar (each ping) and the waterproof lantern on the boat
//   power bank            handheld GPS, hydrophone, and the underwater camera (records while you're under)
// Two small spare packs can take over a flat pack's devices. The torch keeps its own cells and the
// paper map (M) needs no power: they never go off with a pack. The outboard burns its own petrol tank
// (12 L); a 5 L can tops it up. The shed generator burns its own tank to charge whatever's plugged in:
// the power bank while you stand at the shed, the boat battery while the boat is at the mooring.
//
//   5 sonar ping (aboard)   6 lantern   7 hydrophone   8 GPS   9 swap a flat pack's devices to a spare
//   0 at the shed: start / stop the generator (or fill it from the can); aboard: pour the can into the outboard

export const L05_POWER = {
  boatBattery: 100, powerBank: 60, spare: 30, spares: 2,
  sonarPing: 3, lanternPerSec: 0.08, gpsPerSec: 0.05, hydrophonePerSec: 0.06, cameraPerSec: 0.2,
  outboardL: 12, outboardStartL: 8, canL: 5, generatorL: 3, generatorLps: 0.004, generatorCharge: 0.6,
  shedReach: 6, mooringReach: 8, generatorReach: 4,
};

export function createPowerSystem({ map, player, input, notify = () => {}, time = () => 0 }) {
  const C = L05_POWER, log = [];
  const budget = new PowerBudget({ trace: (type, data = {}) => log.push({ t: +time().toFixed(2), system: 'power', type, ...data }), notify });
  budget.addPack('boat', { name: 'boat battery', capacity: C.boatBattery })
    .addPack('bank', { name: 'power bank', capacity: C.powerBank });
  for (let i = 1; i <= C.spares; i++) budget.addPack(`spare${i}`, { name: `spare pack ${i}`, capacity: C.spare, spare: true });
  budget.addDevice('sonar', { name: 'sonar', pack: 'boat' })
    .addDevice('lantern', { name: 'lantern', pack: 'boat', drawPerSec: C.lanternPerSec })
    .addDevice('gps', { name: 'GPS', pack: 'bank', drawPerSec: C.gpsPerSec })
    .addDevice('hydrophone', { name: 'hydrophone', pack: 'bank', drawPerSec: C.hydrophonePerSec })
    .addDevice('camera', { name: 'underwater camera', pack: 'bank', drawPerSec: C.cameraPerSec });
  budget.addTank('outboard', { name: 'outboard tank', litres: C.outboardStartL, capacity: C.outboardL })
    .addTank('can', { name: 'fuel can', litres: C.canL, capacity: C.canL })
    .addTank('generator', { name: 'generator tank', litres: C.generatorL, capacity: C.generatorL });
  budget.addGenerator('gen', { name: 'shed generator', tank: 'generator', litresPerSec: C.generatorLps, chargePerSec: C.generatorCharge });

  const P = map.power ?? {};
  const genAt = P.generator ?? { x: 0, z: 0 }, shedAt = P.shed ?? genAt, mooring = P.mooring ?? genAt;
  let lake = null, lanternLight = null, pings = [];
  const hud = typeof document !== 'undefined' ? new PowerHud() : null;
  const near = (a, r) => Math.hypot(player.position.x - a.x, player.position.z - a.z) <= r;

  const api = {
    budget, log, pings,
    /** The outboard's tank, as the boat reads it (0..1 fuel). */
    outboardTank: budget.tankView('outboard'),
    /** Wire in the water traversal (boat, swimming) once it exists. */
    attach(l) {
      lake = l;
      if (l.boat.mesh) { lanternLight = new THREE.PointLight(0xffe0a0, 0, 14, 1.6); lanternLight.position.set(0, 1.4, -0.6); l.boat.mesh.add(lanternLight); }
    },
    ping() {
      if (!lake?.boat.aboard) { notify('The sonar is mounted on the boat: get aboard to ping.'); return null; }
      if (!budget.draw('sonar', C.sonarPing)) return null;
      const b = lake.boat, depth = +(9 + 7 * Math.sin(b.x * 0.07) * Math.cos(b.z * 0.05) + 4).toFixed(1);
      const r = { t: +time().toFixed(1), at: [+b.x.toFixed(1), +b.z.toFixed(1)], depth };
      pings.push(r); notify(`Sonar: bottom at ${depth} m. No returns.`);
      return r;
    },
    toggle(id) { return budget.setDevice(id, !budget.device(id).wantOn); },
    swap() { return budget.swapFlatToSpare(); },
    /** 0: generator at the shed (start/stop, or fill it from the can); aboard: pour the can into the outboard. */
    fuel() {
      if (lake?.boat.aboard) {
        const moved = budget.pour('can', 'outboard');
        notify(moved > 0 ? `Poured ${moved.toFixed(1)} L into the outboard (tank ${budget.tank('outboard').litres.toFixed(1)} L).` : budget.tank('can').litres <= 0 ? 'The fuel can is empty.' : 'The outboard tank is full.');
        return moved > 0 ? 'poured' : null;
      }
      if (near(genAt, C.generatorReach)) {
        const g = budget.generators.get('gen');
        if (!g.running && budget.tank('generator').litres <= 0) {
          const moved = budget.pour('can', 'generator');
          notify(moved > 0 ? `Filled the generator from the can (${moved.toFixed(1)} L).` : 'The fuel can is empty.');
          return moved > 0 ? 'filled' : null;
        }
        budget.setGenerator('gen', !g.running);
        return g.running ? 'generator on' : 'generator off';
      }
      notify('Nothing to fuel here. The generator is at the shed; the outboard needs you aboard.');
      return null;
    },
    update(dt) {
      // Plugged in at the shed: the bank while you're there; the boat battery while it's moored.
      budget.plug('bank', near(shedAt, C.shedReach) ? 'gen' : null);
      const b = lake?.boat, moored = b && !b.capsized && Math.hypot(b.x - mooring.x, b.z - mooring.z) <= C.mooringReach;
      budget.plug('boat', moored ? 'gen' : null);
      // The underwater camera records while you're under (and only if its pack has charge).
      if (lake) { const under = lake.aquatic.mode === 'under'; if (budget.device('camera').wantOn !== under) budget.setDevice('camera', under); }
      budget.update(dt);
      if (lanternLight) lanternLight.intensity = budget.isOn('lantern') ? 5 : 0;
    },
    render() { hud?.render({ budget, player, boat: lake?.boat, nearGen: near(genAt, C.generatorReach) }); },
  };
  if (typeof addEventListener !== 'undefined') {
    addEventListener('keydown', (e) => {
      if (e.repeat || !input.locked) return;
      const act = { Digit5: () => api.ping(), Digit6: () => api.toggle('lantern'), Digit7: () => api.toggle('hydrophone'), Digit8: () => api.toggle('gps'),
        Digit9: () => api.swap(), Digit0: () => api.fuel() }[e.code];
      act?.();
    });
  }
  return api;
}

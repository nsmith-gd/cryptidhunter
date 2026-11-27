import { Boat } from './boat.js';
import { Aquatic } from './aquatic.js';
import { WaterHud } from './waterHud.js';

// Water traversal for any map that sets `map.water` (L05 Timiskaming; task #139): the rental boat,
// the player's swim / dive / breath state (S13) and their HUD. main.js calls update(dt) right after
// the player moves (so the boat can seat you) and before survival (so thermoregulation sees whether
// you're under), and render() each frame.
//
//   E         board the boat when you're beside it / get out (onto footing, or over the side)
//   hold E    beside a capsized hull, swimming: right it
//   Space     aboard: pull the cord (engine on / off)
//   W/S A/D   aboard: throttle / reverse, steer
//   crouch    swimming: dive (hold your breath); let go to surface
// ?pfd puts a flotation vest on you (until the shop sells one): you can't slip under when exhausted.

export function createWaterTraversal({ scene, map, player, input, survival, notify = () => {}, hasPfd = null, time = () => 0, tank = null }) {
  const W = map.water, log = [];
  const trace = (system) => (type, data = {}) => log.push({ t: +time().toFixed(2), system, type, ...data });
  const pfd = hasPfd ?? (() => typeof location !== 'undefined' && new URLSearchParams(location.search).has('pfd'));
  const boat = new Boat({ scene, x: W.boat.x, z: W.boat.z, heading: W.boat.heading ?? 0, isWater: W.boatWater, footingAt: map.surfaceAt,
    tank: tank ?? W.tank ?? { fuel: 1 }, /* the shared budget's outboard tank (#140) */ storm: () => W.storm ?? 0, trace: trace('boat'), notify });
  const aquatic = new Aquatic({ player, surfaceAt: map.surfaceAt, health: survival.health, isAboard: () => boat.aboard, hasPfd: pfd,
    trace: trace('water'), notify });
  survival.thermo.isSubmerged = () => aquatic.submerged;    // going under soaks you through and chills you faster
  const hud = typeof document !== 'undefined' ? new WaterHud() : null;

  const api = {
    boat, aquatic, log,
    /** E: board, or get out. Returns what happened (for tests). */
    use() {
      if (boat.aboard) return boat.leave(player);
      if (boat.board(player)) return 'boarded';
      return null;
    },
    engine() { return boat.aboard ? boat.setEngine(!boat.engine) : false; },
    update(dt) {
      boat.update(dt, { keys: input.keys, player, holdUse: input.keys.has('KeyE') && !boat.aboard });
      aquatic.update(dt);
    },
    render() { hud?.render({ boat, aquatic, player, nearBoat: !boat.aboard && boat.dist(player.position) <= (boat.capsized ? 2.8 : 3.2) }); },
  };
  if (typeof addEventListener !== 'undefined') {
    addEventListener('keydown', (e) => {
      if (e.repeat || !(input.locked || input.testing)) return;
      if (e.code === 'KeyE' && !boat.capsized) api.use();
      if (e.code === 'Space' && boat.aboard) { e.preventDefault(); api.engine(); }
    });
  }
  return api;
}

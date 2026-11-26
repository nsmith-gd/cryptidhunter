// L01 Cabbagetown tunnels (GDD 1.5 L01, 12.2, 15.2 G01): the authored layout, as pure data.
//
// A fictional network of old service tunnels under a Toronto neighbourhood. Nothing here maps to
// a real sewer or transit system (GDD 6.6 #1). The map is a grid of CELL-metre squares carved
// from rock by straight tunnel segments, so reachability can be proven by a breadth-first
// search over cells (tests and the G01 gym run it for every seed).
//
// What the player meets (cell coordinates; x east, y south):
//   entrance stair (collapses behind you on the first attempt) -> start
//   your packed lunch, dropped in the scramble (one of two spots, seeded)
//   landmark 1: the painted junction (an old mural of a heron), where the tunnel splits three ways
//   landmark 2: the pump room (a huge rusted pump wheel)
//   landmark 3: the grate (a shaft of streetlight falling through an iron grate far above)
//   cold wet detour: a flooded culvert south of the pump room (shallow, with a deep stretch);
//                    the optional trace (a tuft of coarse fur on a grate) is down there
//   dry recovery alcove: a maintenance alcove where an old steam main still gives off heat
//   alternate exit: a ladder up a maintenance shaft to a street hatch, far to the south-east
//   harmless creature proxy: glimpsed at one of two places (seeded); it retreats into a side
//                    chamber from light or closeness and never approaches (GDD 5.4 L01)
//
// Grid legend used by the builder: 0 rock, 1 tunnel, 2 shallow water, 3 deep water.

export const CELL = 4;                 // metres per cell (tunnel width)
export const W = 64, H = 48;           // grid size (cells)
export const CEILING = 3.2;            // tunnel height (m)

// Tunnel segments: polylines of cell waypoints (each leg is straight: same row or column).
const SEGMENTS = [
  // Entrance stair and the first tunnel down to the painted junction.
  [[32, 1], [32, 10]],
  [[32, 4], [35, 4]],                                       // a short side nook near the start
  [[32, 6], [29, 6]],                                       // and another (the lunch is in one of them)
  // Painted junction: west, east and a collapsed south passage.
  [[14, 10], [50, 10]],
  [[32, 10], [32, 16]],                                     // south: ends in an old cave-in (dead end)
  // West: down to the pump room.
  [[14, 10], [14, 23]],
  [[14, 10], [8, 10], [8, 4]],                              // dead end: bricked-up arch
  // Pump room (3 x 3) and its ways out.
  [[13, 23], [15, 23]], [[13, 24], [15, 24]], [[13, 25], [15, 25]],
  [[15, 24], [26, 24]],                                     // east: dry passage to the warm alcove
  [[14, 25], [14, 36]],                                     // south: down into the flooded culvert
  // The cold wet detour: the culvert, then up again into the alcove from below.
  [[14, 36], [30, 36]],
  [[22, 36], [22, 40]],                                     // a side drain (dead end; one trace spot)
  [[30, 36], [30, 30], [27, 30], [27, 26]],
  // The warm alcove (3 x 3) and the passage east to the lower junction.
  [[26, 23], [28, 23]], [[26, 24], [28, 24]], [[26, 25], [28, 25]],
  [[28, 24], [34, 24], [34, 20], [40, 20]],
  // East gallery from the painted junction, to the grate.
  [[50, 10], [50, 4]],                                      // dead end: sealed shaft
  [[50, 10], [58, 10], [58, 19]],
  [[57, 19], [59, 19]], [[57, 20], [59, 20]], [[57, 21], [59, 21]],   // the grate chamber
  [[59, 20], [62, 20]],                                     // dead end past the grate
  [[57, 20], [40, 20]],                                     // west from the grate to the lower junction
  [[44, 20], [44, 14]],                                     // side chamber (the creature's retreat, east glimpse)
  // Lower junction, south to the exit.
  [[40, 20], [40, 32]],
  [[40, 32], [34, 32]],                                     // dead end
  [[40, 32], [52, 32], [52, 40]],
  [[52, 32], [60, 32]],                                     // dead end ("NO EXIT" sign)
  [[52, 40], [58, 40]],
  [[58, 40], [58, 43]],                                     // the exit shaft (ladder at the end)
  // A side chamber off the pump passage (the creature's retreat, west glimpse).
  [[20, 24], [20, 28]],
];

const WATER_SHALLOW = [[14, 31], [14, 36], [15, 36], [16, 36], [17, 36], [18, 36], [19, 36], [20, 36], [21, 36],
  [26, 36], [27, 36], [28, 36], [29, 36], [30, 36], [30, 35], [22, 37], [22, 38], [22, 39], [22, 40],
  [14, 32], [14, 33], [14, 34], [14, 35]];
const WATER_DEEP = [[22, 36], [23, 36], [24, 36], [25, 36]];

/** Fixed places (cell coordinates). */
export const PLACES = {
  entrance: { x: 32, y: 1 },        // the stair up to the street (collapses on the first attempt)
  start: { x: 32, y: 3 },           // where you stand when the tunnel goes dark behind you
  junction: { x: 32, y: 10, name: 'the painted junction', landmark: 1 },
  pumpRoom: { x: 14, y: 24, name: 'the pump room', landmark: 2 },
  grate: { x: 58, y: 20, name: 'the grate', landmark: 3 },
  alcove: { x: 27, y: 24, name: 'the warm alcove' },
  culvert: { x: 18, y: 36, name: 'the flooded culvert' },
  exit: { x: 58, y: 43, name: 'the maintenance ladder' },
};

/** Seeded choices: each option is a cell; the seed picks one per row. */
export const OPTIONS = {
  lunch: [{ x: 35, y: 4 }, { x: 29, y: 6 }],
  trace: [{ x: 24, y: 36 }, { x: 22, y: 40 }],                 // both in the cold wet detour
  creature: [
    { glimpse: { x: 50, y: 10 }, retreat: [{ x: 50, y: 10 }, { x: 50, y: 5 }], side: 'east' },
    { glimpse: { x: 20, y: 24 }, retreat: [{ x: 20, y: 24 }, { x: 20, y: 28 }], side: 'west' },
  ],
};

/** Diegetic painted signs at junctions (old maintenance stencils; no arrows in the HUD). */
export const SIGNS = [
  { x: 32, y: 10, face: 'S', text: 'PUMP RM  <  > SHAFT 3' },
  { x: 14, y: 22, face: 'N', text: 'PUMP RM' },
  { x: 58, y: 18, face: 'N', text: 'SHAFT 3' },
  { x: 40, y: 21, face: 'N', text: 'SHAFT 4 ↓ LADDER' },
  { x: 59, y: 32, face: 'W', text: 'NO EXIT' },
  { x: 52, y: 39, face: 'N', text: 'SHAFT 4' },
  { x: 32, y: 15, face: 'N', text: 'DANGER - CAVE-IN' },
  { x: 8, y: 5, face: 'S', text: 'SEALED 1961' },
  { x: 50, y: 5, face: 'S', text: 'SHAFT 2 - SEALED' },
];

/** Build the grid (Uint8Array W*H) from the segments and water lists. */
export function buildGrid() {
  const g = new Uint8Array(W * H);
  for (const seg of SEGMENTS) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [x0, y0] = seg[i], [x1, y1] = seg[i + 1];
      if (x0 !== x1 && y0 !== y1) throw new Error(`diagonal tunnel leg ${seg[i]} -> ${seg[i + 1]}`);
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = x0 + Math.sign(x1 - x0) * k, y = y0 + Math.sign(y1 - y0) * k;
        g[y * W + x] = 1;
      }
    }
  }
  for (const [x, y] of WATER_SHALLOW) g[y * W + x] = 2;
  for (const [x, y] of WATER_DEEP) g[y * W + x] = 3;
  return g;
}

export const open = (g, x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y * W + x] > 0;

/**
 * Breadth-first distances (in cells) from a cell over open cells. Options:
 * blocked: (x, y) => true for cells to treat as rock (e.g. the collapsed stair, or water to find
 * a dry route).
 */
export function distances(g, from, { blocked = null } = {}) {
  const d = new Int32Array(W * H).fill(-1);
  const q = [from.y * W + from.x];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!open(g, nx, ny) || (blocked && blocked(nx, ny))) continue;
      const j = ny * W + nx;
      if (d[j] >= 0) continue;
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return d;
}

/** The cell path (list of {x, y}) from a to b, or null. */
export function path(g, a, b, opts) {
  const d = distances(g, b, opts);
  if (d[a.y * W + a.x] < 0) return null;
  const out = [{ ...a }];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    let best = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!open(g, nx, ny)) continue;
      const v = d[ny * W + nx];
      if (v >= 0 && v === d[y * W + x] - 1) { best = { x: nx, y: ny }; break; }
    }
    if (!best) return null;
    ({ x, y } = best);
    out.push(best);
  }
  return out;
}

/** World metres for the centre of a cell (the grid is centred on the origin). */
export const cellToWorld = (c) => ({ x: (c.x - W / 2 + 0.5) * CELL, z: (c.y - H / 2 + 0.5) * CELL });
export const worldToCell = (x, z) => ({ x: Math.floor(x / CELL + W / 2), y: Math.floor(z / CELL + H / 2) });

/**
 * The layout for one seed: the grid plus the seeded picks. rand: () => [0, 1).
 * Every seed yields the same tunnels; only where the lunch, the trace and the glimpse are changes.
 */
export function layoutFor(rand) {
  const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
  return { grid: buildGrid(), lunch: pick(OPTIONS.lunch), trace: pick(OPTIONS.trace), creature: pick(OPTIONS.creature) };
}

/** Facts the G01 pass rules need, for one layout (used by the unit test and the in-game gym). */
export function audit(layout) {
  const g = layout.grid, collapsed = (x, y) => x === PLACES.entrance.x && y === PLACES.entrance.y;
  const from = PLACES.start, d = distances(g, from, { blocked: collapsed });
  const dry = distances(g, from, { blocked: (x, y) => collapsed(x, y) || g[y * W + x] >= 2 });
  const at = (arr, c) => arr[c.y * W + c.x];
  let cells = 0; for (const v of g) if (v) cells++;
  return {
    exitReachable: at(d, PLACES.exit) >= 0,
    exitReachableDry: at(dry, PLACES.exit) >= 0,           // the cold detour is optional
    alcoveReachableDry: at(dry, PLACES.alcove) >= 0,       // recovery without getting wet first
    lunchReachable: at(d, layout.lunch) >= 0,
    traceReachable: at(d, layout.trace) >= 0,
    traceInDetour: g[layout.trace.y * W + layout.trace.x] >= 2,
    landmarksReachable: ['junction', 'pumpRoom', 'grate'].every((k) => at(d, PLACES[k]) >= 0),
    shortestEscapeM: at(dry, PLACES.exit) * CELL,
    tunnelM: cells * CELL,
  };
}

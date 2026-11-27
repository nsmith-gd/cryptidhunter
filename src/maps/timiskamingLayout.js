// Lake Timiskaming (L05, the Mugwump) greybox layout: pure data and queries, no rendering (#139).
// A main basin with two bays (north and east), a shallow rim around all of it, a shore hub on the
// south shore (dock, rental shed, heated warming hut) and a road out (the land exit). A shore trail
// rings the whole lake on dry ground, so wherever you get out of the water you can walk back.

export const TIMI = {
  half: 120,
  basins: [
    { id: 'main', name: 'the main basin', x: 0, z: -30, rx: 48, rz: 34 },
    { id: 'north', name: 'the north bay', x: -32, z: -72, rx: 22, rz: 16 },
    { id: 'east', name: 'the east bay', x: 54, z: -44, rx: 18, rz: 11 },
  ],
  shallow: 5,                                   // metres of wadeable rim inside the waterline
  dock: { x0: -1.2, x1: 1.2, z0: -1.5, z1: 9 }, // a platform out over the shallows: dry footing
  mooring: { x: 3.2, z: 0, heading: 0 },         // the rental boat, tied up off the dock end
  shed: { x: 7, z: 15 }, hut: { x: -10, z: 15 }, start: { x: 0, z: 24 },
  exit: { x: 14, z: 46, name: 'the road out' },
  trailOffset: 7,                               // the shore trail runs this far outside the waterline
};

const inEllipse = (b, x, z, shrink = 0) => ((x - b.x) / (b.rx - shrink)) ** 2 + ((z - b.z) / (b.rz - shrink)) ** 2 < 1;
export const inWater = (x, z, shrink = 0) => TIMI.basins.some((b) => inEllipse(b, x, z, shrink));
export const onDock = (x, z) => { const d = TIMI.dock; return x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1; };

/** 'dry' | 'shallow' | 'deep' underfoot (y above the water counts as dry: the boat seat, the dock). */
export function surfaceAt(x, z, y = 0) {
  if (y > 0.15 || onDock(x, z)) return 'dry';
  if (!inWater(x, z)) return 'dry';
  return inWater(x, z, TIMI.shallow) ? 'deep' : 'shallow';
}
/** Where the hull floats: water deep enough to keep off the bottom. */
export const boatWater = (x, z) => inWater(x, z, 1.5) && !onDock(x, z);
/** Which basin or bay a point is in (for messages and the trace). */
export const basinAt = (x, z) => TIMI.basins.find((b) => inEllipse(b, x, z)) ?? null;

/**
 * The shore trail: a ring of points on dry ground just outside the waterline, found by marching
 * out from the lake's middle at each bearing. Closed loop (the last point joins the first).
 */
export function shoreTrail(n = 96) {
  const cx = 6, cz = -42, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let r = 0;
    while (r < 200 && inWater(cx + dx * r, cz + dz * r)) r += 0.5;
    // keep going past any water further out along this bearing (a bay behind a point)
    let far = r; for (let t = r; t < 200; t += 1) if (inWater(cx + dx * t, cz + dz * t)) far = t;
    r = far + TIMI.trailOffset;
    pts.push({ x: +(cx + dx * r).toFixed(2), z: +(cz + dz * r).toFixed(2) });
  }
  return pts;
}

/** Nearest trail point to (x, z), and its index. */
export function nearestTrail(trail, x, z) {
  let best = 0, bd = Infinity;
  trail.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } });
  return { i: best, d: bd, p: trail[best] };
}

/** The dry walking route from a trail point back to the hub: along the trail the shorter way round. */
export function trailRouteHome(trail, fromIndex) {
  const home = nearestTrail(trail, TIMI.start.x, TIMI.start.z).i, n = trail.length;
  const fwd = (home - fromIndex + n) % n, back = (fromIndex - home + n) % n;
  const step = fwd <= back ? 1 : -1, count = Math.min(fwd, back), route = [];
  for (let k = 0; k <= count; k++) route.push(trail[(fromIndex + step * k + n) % n]);
  return route;
}

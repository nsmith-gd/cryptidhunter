// Pure helpers for reading a clue: which way the cryptid went and how fresh it is.
// World convention: north = -Z, east = +X. Heading 0 = north, clockwise, radians.

export const COMPASS = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
];

/** Heading in radians (0 = north, clockwise, 0..2PI) for a world-space delta. */
export function headingOf(dx, dz) {
  const a = Math.atan2(dx, -dz);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** Nearest compass octant index 0..7 for a heading in radians. */
export function octantOfHeading(h) {
  return ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
}

export function compassName(dx, dz) {
  return COMPASS[octantOfHeading(headingOf(dx, dz))];
}

/**
 * The point `dist` metres further along a route (array of {x, z}) from index `from`,
 * or the route's end (where the cryptid is now) if the route is shorter.
 */
export function pointAhead(path, from, dist) {
  let left = dist;
  for (let i = Math.max(0, from); i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg >= left) {
      const t = seg > 0 ? left / seg : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= seg;
  }
  return path[path.length - 1];
}

/** Index of the route point nearest (x, z). */
export function nearestIndex(path, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Freshness wording from a clue's age (seconds). */
export function freshness(age) {
  if (age < 30) return 'Very fresh';
  if (age < 90) return 'Fresh';
  if (age < 180) return 'A few minutes old';
  return 'Old';
}

const NOUN = { footprint: 'footprint', hair: 'hair', scratch: 'scratch marks', branch: 'snapped branch', scat: 'droppings', deerTrack: 'hoof prints', foxTrack: 'paw prints', owlFeather: 'feather', wingDust: 'dusty scales' };

/**
 * Hint for a clue: "Fresh footprint, heading north-east."
 * @param {{type, age, origin:{x,z}}} clue
 * @param {{x,z}} ahead where the route leads from this clue (see pointAhead)
 */
export function clueHint(clue, ahead) {
  const dx = ahead.x - clue.origin.x, dz = ahead.z - clue.origin.z;
  const noun = NOUN[clue.type] ?? clue.type;
  if (Math.hypot(dx, dz) < 1.5) return `${freshness(clue.age)} ${noun}. It was here moments ago. It's close.`;
  return `${freshness(clue.age)} ${noun}, heading ${compassName(dx, dz)}.`;
}

/** Hint when the cryptid that left the clue is gone from the level. */
export function coldHint(clue) {
  return `${freshness(clue.age)} ${NOUN[clue.type] ?? clue.type}. The trail has gone cold.`;
}

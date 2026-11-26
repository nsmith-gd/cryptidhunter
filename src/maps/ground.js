// Ground height under a point (#61 follow-up: sunken trail ruts). The active map registers its
// terrain height function; the player's feet, cryptids and ground clues stand on it. Maps with no
// carved terrain leave it unset: the ground is then the flat y = 0 plane everywhere.
let heightFn = null;
export function setGroundHeight(fn) { heightFn = fn ?? null; }
export function groundAt(x, z) { return heightFn ? heightFn(x, z) : 0; }

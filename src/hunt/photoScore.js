// Photo quality score (0-100) shared by every way of taking a picture.
// Closer and more of the subject visible = better. Gear that shoots on its own (trail cameras)
// takes grainy, badly framed pictures, so it scores a fraction of a handheld shot.
export const PHOTO_SCORE = {
  range: 60,            // metres at which a shot is worth nothing
  trailCamFactor: 0.5,  // trail-camera photos score half of an equivalent handheld shot
};

export function scorePhoto({ distance, visible = 1, samples = 1, factor = 1 }) {
  if (!(distance >= 0)) return 0;
  const near = Math.max(0, 1 - distance / PHOTO_SCORE.range) ** 0.7;
  const shown = Math.max(0, Math.min(1, samples ? visible / samples : 1)) ** 0.5;
  return Math.round(100 * near * shown * factor);
}

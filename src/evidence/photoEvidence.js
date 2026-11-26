import * as THREE from 'three';

// Photographic evidence capture (GDD 4.3 lifecycle and record, 4.4 acquisition + preview, 4.5
// quality components). #85: every frame you shoot is checked for what it actually shows, gets a
// quality snapshot at the moment of the shutter, and becomes an evidence record on the camera's
// roll. Records go home with you (extracted) or are lost with the camera, and are kept in the
// career's evidence archive for review.
//
// Quality components (each 0-1), measured from game state, never from rendered pixels, so render
// and pixel settings cannot change evidence (GDD 15.2 G00):
//   C clarity         light on the subject x steadiness (motion blur) x lens resolution at range
//   I identification  distinctive features resolvable: subject size in frame (+ the head showing
//                     for a creature; for a footprint, how close and how top-down the shot is),
//                     only as far as the light lets you make them out (a near-black frame shows a shape)
//   K completeness    how much of the subject is in frame and unobstructed (coverage)
//   P provenance      time and place recorded during a committed expedition, with surroundings
//                     in frame for context (a frame-filling close-up loses some context)
// Q = round(100 x (0.30C + 0.35I + 0.20K + 0.15P) x integrity)   (GDD 4.5; integrity starts at 1)
// Grades, verification and sale value are HQ's job (#99/#100); the field preview only names
// actionable problems (GDD 4.4: no species and no price before verification).

export const PHOTO_EVIDENCE = {
  lightK: 2.2,               // exposure curve: L = 1 - exp(-lux * k)
  ambientLux: 1.6,           // x map light level (forest night 0.05 -> lux 0.08 -> L ~0.16)
  nightVisionFloor: 0.6,     // goggles make a dark subject readable, but grainy
  darkBelow: 0.35,           // preview: "too dark"; features fully readable from here up
  readableFrom: 0.1,         // below this light nothing distinctive can be made out (identification 0)
  blurBelow: 0.75,           // preview: "blurred"
  coverBelow: 0.6,           // preview: "partly hidden or cut off"
  smallBelow: 0.12,          // preview: "too small in frame" (share of frame height)
  sharpWithin: 25,           // metres: lens resolution starts to fall beyond this
  sightingGap: 90,           // seconds: photos of the same creature closer than this are one event
  clueReach: 7,              // metres: beyond this a clue photo can't show the print
};

export const PHOTO_TYPES = {
  creature: { id: 'EV03', name: 'Creature photograph' },
  footprint: { id: 'EV01', name: 'Footprint photograph' },
  disturbance: { id: 'EV04', name: 'Disturbance photograph' },
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();

/**
 * Light falling on a world point (0..1) from the gameplay light sources: point and spot lights
 * (torch, lamps, fires, a trail camera's IR flash) plus the map's authored ambient level.
 * Directional and hemisphere lights are presentation (moon fill, cinematic grading) and don't count.
 */
export function lightAt(scene, point, { ambient = 0.05, nightVision = false } = {}) {
  let lux = ambient * PHOTO_EVIDENCE.ambientLux;
  scene.traverseVisible((o) => {
    if (!o.isLight || !(o.isPointLight || o.isSpotLight) || o.intensity <= 0) return;
    o.getWorldPosition(_p);
    const d = Math.max(0.5, _p.distanceTo(point));
    if (o.distance > 0 && d >= o.distance) return;
    const window = o.distance > 0 ? clamp01(1 - (d / o.distance) ** 4) : 1;
    let cone = 1;
    if (o.isSpotLight) {
      o.target.getWorldPosition(_t);
      const axis = _d.subVectors(_t, _p).normalize();
      const ang = axis.angleTo(_t.subVectors(point, _p));
      const outer = o.angle, inner = o.angle * (1 - o.penumbra);
      cone = ang >= outer ? 0 : ang <= inner ? 1 : 1 - (ang - inner) / (outer - inner);
    }
    lux += o.intensity * window * cone / Math.pow(d, o.decay || 2);
  });
  const L = 1 - Math.exp(-lux * PHOTO_EVIDENCE.lightK);
  return nightVision ? Math.max(L, PHOTO_EVIDENCE.nightVisionFloor) : L;
}

/** GDD 4.5 quality from the four components (and integrity). */
export function qualityScore({ C, I, K, P }, integrity = 1) {
  return Math.max(0, Math.min(100, Math.round(100 * (0.30 * C + 0.35 * I + 0.20 * K + 0.15 * P) * integrity)));
}

/**
 * Quality snapshot for a creature photo. shot: the camera's evaluation ({ visible, samples,
 * screenSize, distance, headVisible }), light 0..1 on the subject, steadiness 0..1, committed:
 * taken during a committed expedition (time/place on record).
 */
export function creatureQuality({ shot, light, steadiness, committed = true }) {
  const range = clamp01(1 - (shot.distance - PHOTO_EVIDENCE.sharpWithin) / 45);
  const C = clamp01(light * steadiness * (0.4 + 0.6 * range));
  // Features must be readable to identify anything: near-black frames show a shape at best.
  const readable = clamp01((light - PHOTO_EVIDENCE.readableFrom) / (PHOTO_EVIDENCE.darkBelow - PHOTO_EVIDENCE.readableFrom));
  const I = clamp01((0.6 * Math.min(1, (shot.screenSize ?? 0) / 0.3) + (shot.headVisible ? 0.4 : 0)) * readable);
  const K = clamp01(shot.visible / Math.max(1, shot.samples));
  const P = clamp01((committed ? 0.7 : 0.35) + ((shot.screenSize ?? 0) < 0.85 ? 0.3 : 0.1));
  const comp = { C: +C.toFixed(3), I: +I.toFixed(3), K: +K.toFixed(3), P: +P.toFixed(3) };
  const problems = [];
  if (light < PHOTO_EVIDENCE.darkBelow) problems.push('Too dark: light the subject (torch, lamp or night vision)');
  if (steadiness < PHOTO_EVIDENCE.blurBelow) problems.push('Blurred: hold still while you shoot');
  if (K < PHOTO_EVIDENCE.coverBelow) problems.push('Partly hidden or cut off: get a clear view of all of it');
  if ((shot.screenSize ?? 0) < PHOTO_EVIDENCE.smallBelow) problems.push('Too small in the frame: get closer or zoom in');
  else if (!shot.headVisible) problems.push('Head not in the shot: features are hard to make out');
  return { ...comp, integrity: 1, Q: qualityScore(comp), light: +light.toFixed(3), steadiness: +steadiness.toFixed(3), problems };
}

/**
 * Quality snapshot for a photo of a ground clue (footprint / disturbance). view: { inFrame 0..1,
 * unobstructed 0..1, distance, downAngle (radians below horizontal of the line to the clue) }.
 */
export function clueQuality({ view, light, steadiness, committed = true }) {
  const near = clamp01((PHOTO_EVIDENCE.clueReach - view.distance) / (PHOTO_EVIDENCE.clueReach - 1.5));
  const overhead = clamp01(view.downAngle / (Math.PI / 3));          // looking down at it: 60 deg or more is ideal
  const C = clamp01(light * steadiness);
  const readable = clamp01((light - PHOTO_EVIDENCE.readableFrom) / (PHOTO_EVIDENCE.darkBelow - PHOTO_EVIDENCE.readableFrom));
  const I = clamp01((0.55 * near + 0.45 * overhead) * readable);
  const K = clamp01(view.inFrame * view.unobstructed);
  const P = clamp01(committed ? 0.85 : 0.45);
  const comp = { C: +C.toFixed(3), I: +I.toFixed(3), K: +K.toFixed(3), P: +P.toFixed(3) };
  const problems = [];
  if (light < PHOTO_EVIDENCE.darkBelow) problems.push('Too dark: shine your torch on it');
  if (steadiness < PHOTO_EVIDENCE.blurBelow) problems.push('Blurred: hold still while you shoot');
  if (K < PHOTO_EVIDENCE.coverBelow) problems.push('Not all of it is in the frame');
  if (near < 0.5) problems.push('Too far away to read the detail: step closer');
  if (overhead < 0.45) problems.push('Shot from too low an angle: photograph it from above');
  return { ...comp, integrity: 1, Q: qualityScore(comp), light: +light.toFixed(3), steadiness: +steadiness.toFixed(3), problems };
}

/**
 * The evidence record kept on the camera's roll (GDD 4.3). source holds the actual source (which
 * creature, or an ordinary animal); it is hidden in the field and only read at evaluation.
 */
export function photoRecord({ id, kind, source, eventId, attemptId, time, location, frame, quality, thumb = null, device = 'F01 handheld camera' }) {
  const t = PHOTO_TYPES[kind];
  return {
    id, type: t.id, typeName: t.name, family: 'Imagery', kind,
    source,                                 // { kind: 'creature' | 'clue', id, actual } (hidden until evaluation)
    eventId, attemptId,
    time: +time.toFixed(1), location: { x: +location.x.toFixed(1), z: +location.z.toFixed(1) },
    method: 'photograph', device, frame,
    state: 'secured',                       // on the camera you carry (GDD 4.3: secured in carried inventory)
    quality,                                // snapshot at the shutter; only real damage lowers integrity later
    thumb,
    history: [{ state: 'secured', time: +time.toFixed(1) }],
  };
}

/** Move records to a new lifecycle state (extracted, lost, evaluated, sold...). */
export function advance(records, state, time = null) {
  for (const r of records) { r.state = state; r.history.push({ state, ...(time != null ? { time: +time.toFixed(1) } : {}) }); }
  return records;
}

/**
 * The career's evidence archive: every photo record you brought home, kept across hunts for
 * review (and for HQ verification / sale by #99 and #100). Lightweight metadata + thumbnail
 * (GDD 4.3: no literal video or full-size image storage). Saved in the save file.
 */
export class EvidenceArchive {
  constructor(saveService, { max = 200, thumbs = 40 } = {}) {
    this.saveService = saveService;
    this.max = max;
    this.thumbs = thumbs;
    this.records = saveService?.load?.().evidenceArchive ?? [];
  }

  /** Add extracted records (by stable ID; adding the same record twice keeps one copy). */
  add(records) {
    const ids = new Set(this.records.map((r) => r.id));
    for (const r of records) if (!ids.has(r.id)) { this.records.push(r); ids.add(r.id); }
    // Keep the newest; drop the oldest thumbnails first if the archive grows large.
    if (this.records.length > this.max) this.records = this.records.slice(-this.max);
    // Thumbnails are the heavy part of the save: keep them for the newest records only.
    this.records.forEach((r, i) => { if (i < this.records.length - this.thumbs) r.thumb = null; });
    this.save();
    return this.records;
  }

  save() {
    if (!this.saveService) return;
    this.saveService.save({ ...this.saveService.load(), evidenceArchive: this.records });
  }

  best() { return this.records.reduce((b, r) => (!b || r.quality.Q > b.quality.Q ? r : b), null); }
}

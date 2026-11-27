// Evidence quality grades and HQ verification (GDD 4.3–4.5, 4.7; task #99).
//
// Every record carries a quality snapshot taken when it was acquired: four components, each 0–1,
//   C clarity         readable at all: light on the subject and a steady hand (samples: condition)
//   I identification  distinctive features showing: big enough in frame / close enough (samples: by type)
//   K completeness    how much of it is covered: unhidden share, whole print in frame (samples: amount)
//   P provenance      where/when/how: handheld shots and in-place collection log time and place; an
//                     unattended trail camera less so
// Q = round(100 × (0.30C + 0.35I + 0.20K + 0.15P) × integrity), clamped 0–100, then a grade 0–4.
// Integrity starts at 1 and only real later damage lowers it (nothing damages evidence yet).
//
// Authenticity is separate from quality: every record also carries a hidden ground-truth `source`
// (the cryptid or ordinary animal that really made it). Verification at HQ is deterministic: an
// ordinary animal's sign is rejected for the cryptid claim however sharp it is; no random rolls.
// Nothing here is shown in the field except the actionable problems ("too dark"); grades, reasons
// and sale values appear only on the HQ verification screen after you drive home.

export const QUALITY = {
  weights: { C: 0.30, I: 0.35, K: 0.20, P: 0.15 },
  grades: [
    { grade: 0, name: 'Inconclusive', min: 0, M: 0 },
    { grade: 1, name: 'Weak', min: 20, M: 0.25 },
    { grade: 2, name: 'Suggestive', min: 40, M: 0.55 },
    { grade: 3, name: 'Compelling', min: 60, M: 0.80 },
    { grade: 4, name: 'Exceptional', min: 80, M: 1.00 },
  ],
  // GDD 4.2 base reward units B and diagnostic factor D per evidence type.
  types: {
    EV01: { name: 'Footprint photo', B: 10, D: 0.30 },
    EV02: { name: 'Physical trace', B: 15, D: 0.40 },
    EV03: { name: 'Creature photo', B: 35, D: 0.80 },
    EV04: { name: 'Disturbance photo', B: 8, D: 0.20 },
    EV05: { name: 'Footprint cast', B: 20, D: 0.50 },
    EV06: { name: 'Biological sample', B: 30, D: 0.80 },
  },
  T: 250,               // L01 ordinary expedition settlement ceiling ($); per-attempt cap comes with #100
  novelty: [1, 0.5, 0.25],
  // Light: the moon/ambient level counts this many times over; local lights add on top.
  ambientGain: 3,
  nightVisionLight: 0.7,   // goggles amplify what's there; grainy, so never full clarity
  trailCamLight: 0.85,     // a trail camera's IR flash lights its subject
  trailCamProvenance: 0.7, // unattended: nobody saw it happen
};

// Ordinary animals are false leads (GDD 4.4): the cue that gives each away, shown at HQ.
export const ORDINARY = {
  deer: { name: 'White-tailed deer', cue: 'two narrow split-hoof marks: a deer track' },
  bear: { name: 'Black bear', cue: 'claw marks ahead of five short toes and a broad pad: a black bear track' },
  coyote: { name: 'Coyote', cue: 'small twisted droppings full of fur and bone chips: a coyote' },
};
export const isOrdinary = (source) => Object.hasOwn(ORDINARY, source);

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Q from components (each 0–1) and integrity (0–1). */
export function qualityScore({ C, I, K, P }, integrity = 1) {
  const w = QUALITY.weights;
  const q = 100 * (w.C * clamp01(C) + w.I * clamp01(I) + w.K * clamp01(K) + w.P * clamp01(P)) * clamp01(integrity);
  return Math.max(0, Math.min(100, Math.round(q)));
}

/** Grade 0–4 for a Q, with its name and valuation multiplier M. */
export function gradeOf(q) {
  let g = QUALITY.grades[0];
  for (const x of QUALITY.grades) if (q >= x.min) g = x;
  return g;
}

/**
 * The actionable problems with a record, worst first (GDD 4.4: "poor light, obscured subject").
 * Said in plain words; these are the only quality feedback in the field.
 */
export function issuesOf(c, kind = 'photo') {
  const out = [];
  if (kind === 'sample') {
    if (c.C < 0.6) out.push([c.C, 'old and weathered: much of it had broken down']);
    if (c.K < 0.7) out.push([c.K, 'only a small amount collected']);
    return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }
  if (c.light != null && c.light < 0.45) out.push([c.light, 'too dark: the subject was barely lit']);
  if (c.steady != null && c.steady < 0.7) out.push([c.steady, 'blurred: the camera was moving']);
  if (c.I < 0.4) out.push([c.I, kind === 'clue' ? 'too far away to make out detail' : 'too small in the frame']);
  if (c.K < 0.6) out.push([c.K, kind === 'clue' ? 'not centred: only part of it in frame' : 'mostly hidden behind cover']);
  if (c.P < 0.8) out.push([c.P, 'no witness: an unattended camera took it']);
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/** Build the quality snapshot for a record: components, Q, grade and problems. */
export function snapshot(components, { kind = 'photo', integrity = 1 } = {}) {
  const c = { ...components };
  for (const k of ['C', 'I', 'K', 'P']) c[k] = +clamp01(c[k]).toFixed(3);
  const Q = qualityScore(c, integrity);
  return { components: c, integrity, Q, grade: gradeOf(Q).grade, issues: issuesOf(c, kind) };
}

// ---- Components for each way of getting evidence ------------------------------------------------

/** Creature photo (EV03). r: the camera's evaluation; light 0–1 on the subject; steady 0–1. */
export function creaturePhotoComponents(r, { light, steady, sizeShare, provenance = 1 }) {
  return {
    C: clamp01(light) * clamp01(steady),
    I: clamp01(sizeShare),
    K: r.samples ? r.visible / r.samples : 0,
    P: provenance,
    light: +clamp01(light).toFixed(3), steady: +clamp01(steady).toFixed(3),
  };
}

/** Photo of a clue (EV01 footprint, EV04 disturbance): how close, how centred, how lit, how fresh. */
export function cluePhotoComponents({ distance, offAngle, maxAngle, light, steady = 1, freshness = 1 }) {
  const near = clamp01(1 - (distance - 1.5) / 6);          // 1.5 m: every ridge readable; 7.5 m: a smudge
  return {
    C: clamp01(light) * clamp01(steady),
    I: (0.25 + 0.75 * near) * (0.5 + 0.5 * clamp01(freshness)),
    K: clamp01(1 - 0.6 * (offAngle / maxAngle)),
    P: 1,
    light: +clamp01(light).toFixed(3), steady: +clamp01(steady).toFixed(3),
  };
}

/** Physical sample (EV02 trace, EV05 cast, EV06 biological): condition from freshness, by type. */
export function sampleComponents(evId, { freshness = 1, complete = 1 }) {
  const I = { EV02: 0.6, EV05: 0.85, EV06: 0.75 }[evId] ?? 0.5;
  return { C: 0.35 + 0.65 * clamp01(freshness), I, K: clamp01(complete), P: 1 };
}

/**
 * Light falling on a point, 0–1: the night's ambient level, every visible local light in the
 * scene (the flashlight is one of them) by its range, falloff and cone, and night vision.
 * Local lights don't test occlusion (cheap approximation of the same light the AI reads).
 */
export function lightAt(scene, point, { ambient = 0, nightVision = false, THREE } = {}) {
  let sum = ambient * QUALITY.ambientGain;
  const lp = new THREE.Vector3(), tp = new THREE.Vector3(), dir = new THREE.Vector3(), to = new THREE.Vector3();
  scene.traverseVisible((l) => {
    if (!(l.isSpotLight || l.isPointLight) || l.intensity <= 0) return;
    l.getWorldPosition(lp);
    const d = lp.distanceTo(point);
    if (l.distance > 0 && d >= l.distance) return;
    let k = l.distance > 0 ? Math.pow(1 - d / l.distance, l.decay || 1) : 1 / (1 + d * d);
    if (l.isSpotLight) {
      l.target.getWorldPosition(tp);
      dir.subVectors(tp, lp).normalize();
      to.subVectors(point, lp).normalize();
      const a = dir.angleTo(to);
      if (a > l.angle) return;
      const inner = l.angle * (1 - (l.penumbra ?? 0));
      if (a > inner) k *= 1 - (a - inner) / Math.max(1e-6, l.angle - inner);
    }
    sum += l.intensity * k / 4;
  });
  if (nightVision) sum = Math.max(sum, QUALITY.nightVisionLight);
  return clamp01(sum);
}

// ---- Verification at HQ ---------------------------------------------------------------------

/**
 * Verify one extracted record. Deterministic: the hidden source decides authenticity, Q decides
 * the grade. Returns { status: 'accepted' | 'rejected' | 'inconclusive', grade, M, reason }.
 * record: { evId, source, claim, Q, issues, duplicateOf? }
 */
export function verify(record) {
  const g = gradeOf(record.Q);
  if (isOrdinary(record.source)) {
    return { status: 'rejected', grade: g.grade, M: 0, reason: `Rejected: ${ORDINARY[record.source].cue}. Ordinary animal, not ${record.claim ?? 'a cryptid'}.` };
  }
  if (!record.source) return { status: 'rejected', grade: 0, M: 0, reason: 'Rejected: nothing identifiable in it.' };
  if (record.duplicateOf) return { status: 'accepted', grade: g.grade, M: 0, reason: `Same sighting as a better record (${record.duplicateOf}): only the best one sells.` };
  if (g.grade === 0) return { status: 'inconclusive', grade: 0, M: 0, reason: `Inconclusive: ${record.issues?.[0] ?? 'too little to go on'}. Kept as a lead.` };
  const why = record.issues?.length ? `held back: ${record.issues[0]}` : 'clear and distinctive';
  return { status: 'accepted', grade: g.grade, M: g.M, reason: `${g.name} (grade ${g.grade}) ${record.sourceName ?? ''} evidence, ${why}.`.replace('  ', ' ') };
}

/** Provisional offer for an accepted record: round(T × 0.01 × B × M × N × A) (GDD 4.7). */
export function offer({ evId, M, N = 1, A = 1, T = QUALITY.T }) {
  const B = QUALITY.types[evId]?.B ?? 0;
  return Math.round(T * 0.01 * B * M * N * A + 1e-9);
}

/**
 * Verify and value everything brought home. Photos of the same subject are one sighting here:
 * the best sells, the rest are duplicates (#100 widens this to event IDs and saved entitlements).
 * Novelty within the dossier: 1 / 0.5 / 0.25 per species and type among accepted records.
 */
export function verifyAll(records) {
  const out = records.map((r) => ({ ...r }));
  // Creature photos: one sighting per subject this hunt (best Q sells).
  const bestPhoto = new Map();
  for (const r of out) if (r.evId === 'EV03' && !isOrdinary(r.source)) {
    const b = bestPhoto.get(r.source);
    if (!b || r.Q > b.Q) bestPhoto.set(r.source, r);
  }
  for (const r of out) if (r.evId === 'EV03' && bestPhoto.get(r.source) && bestPhoto.get(r.source) !== r) r.duplicateOf = `photo ${bestPhoto.get(r.source).label}`;
  const seen = new Map();
  const ranked = [...out].sort((a, b) => b.Q - a.Q);
  for (const r of ranked) {
    const v = verify(r);
    Object.assign(r, { verification: v });
    let N = 0;
    if (v.status === 'accepted' && v.M > 0) {
      const key = `${r.source}:${r.evId}`;
      const n = seen.get(key) ?? 0; seen.set(key, n + 1);
      N = QUALITY.novelty[Math.min(n, QUALITY.novelty.length - 1)];
    }
    r.novelty = N;
    r.value = v.M > 0 ? offer({ evId: r.evId, M: v.M, N }) : 0;
  }
  return out;
}

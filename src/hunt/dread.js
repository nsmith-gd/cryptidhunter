import * as THREE from 'three';

// Dread (#114): the night gets scarier the longer you stay out and the deeper you go.
// Director: "it needs to get scarier and scarier as I continue moving… more like I am lost in a
// woodland forest." Fear (hunt/fear.js) is the moment-to-moment jolt; dread is the slow build
// underneath it. It almost never goes back down: the woods don't get friendlier.
//
//   Builds   with time out of the van, with how far you are from it (the deep woods), in the dark
//            (torch off), with each fresh sign you find (it's close), and a share of every scare.
//   Eases    only a little, and only somewhere safe and lit (the van, the cabin, by a fire).
//   Stages   0 Uneasy · 1 Watched · 2 Hunted · 3 Dread. Each new stage lands once with a line of
//            what you notice ("The crickets have stopped.").
//   Effects  (real consequences; never a meter on screen, #131)
//            · Sight: the fog closes in (you see less far: harder to spot it, harder to navigate);
//              at Dread the torch stutters now and then.
//            · Sound: the forest's night chorus thins and dies; your breathing and a heartbeat rise.
//            · Your hands: a tremor on the torch and camera you hold (never the view itself).
//            · Fear rises faster in the dark and near it (it builds on what you already feel).
//            · The creature gets bolder: its escalation level rises (quicker to anger, more real
//              charges), so the danger is real, not just an effect.
// While it affects you a short label says so ("Shaken: hands unsteady, breathing loud"), and the
// status screen lists it with its cause and what to do. In VR the tremor is on the held tools only.

export const DREAD = {
  timeRate: 100 / (20 * 60),   // ~20 min out alone takes you to the top, before anything else
  depthRate: 0.04,             // extra per second at full depth (far side of the map)
  darkRate: 0.05,              // extra per second with your torch off (and no lamp)
  clueBump: 3,                 // each fresh sign you examine
  scareShare: 0.2,             // share of every scare that stays with you
  safeEase: 0.25,              // per second in a lit safe place, never below the floor
  floorShare: 0.6,             // easing stops at 60% of the highest dread you've reached
  stages: [
    { at: 0, name: 'Uneasy', note: '' },
    { at: 25, name: 'Watched', note: 'The crickets have stopped. Something in the trees is very quiet.' },
    { at: 50, name: 'Hunted', note: 'A branch cracks behind you, then nothing. You are not alone out here.' },
    { at: 75, name: 'Dread', note: 'Your heart is pounding. The woods feel closer, and your torch flickers.' },
  ],
  fogFarMin: 0.45,             // at full dread the fog's far distance shrinks to this share
  fearMul: 1.8,                // fear's rise rates at full dread
};

export class Dread {
  /**
   * getHome(): {x, z} the van. half: map half-size (for depth). getThreats(): cryptids to embolden.
   * isSafe(): true in a lit safe place. fear: Fear. flashlight. scene (fog). camera (for the vignette).
   */
  constructor({ player, fear, flashlight, scene, getHome, half = 150, getThreats = () => [], isSafe = () => false, notify = () => {}, vr = () => false }) {
    Object.assign(this, { player, fear, flashlight, scene, getHome, half, getThreats, isSafe, notify, vr });
    this.value = 0; this.peak = 0; this.stage = 0; this.time = 0; this.outside = 0;
    this.log = [];                 // { t, stage, value } each stage change; samples for checks
    this.samples = [];
    this.fogObj = null; this.fogBase = null; this.sightShare = 1;
    this.baseLevels = new Map();
    this.flicker = 0;
    this.buildOverlay();
  }

  get level() { return this.value / 100; }
  get stageName() { return DREAD.stages[this.stage].name; }

  /** How deep into the woods you are, 0 at the van .. 1 at the far side. */
  depth() {
    const h = this.getHome(), p = this.player.position;
    return Math.min(1, Math.hypot(p.x - h.x, p.z - h.z) / (this.half * 1.4));
  }

  /** A fresh sign examined: it's close, and it's real. */
  onClue() { this.add(DREAD.clueBump, 'sign'); }
  /** A scare: some of it stays with you. */
  onScare(amount) { this.add(amount * DREAD.scareShare, 'scare'); }

  add(v) { this.value = Math.min(100, this.value + v); }

  update(dt, { active = true } = {}) {
    this.time += dt;
    if (!active) return;
    const safe = this.isSafe();
    if (safe) this.value = Math.max(this.peak * DREAD.floorShare, this.value - DREAD.safeEase * dt);
    else {
      this.outside += dt;
      const dark = !(this.flashlight.on && (this.flashlight.battery ?? 1) > 0) && (this.fear?.lampLight?.() ?? 0) < 0.2;
      this.value += (DREAD.timeRate + DREAD.depthRate * this.depth() + (dark ? DREAD.darkRate : 0)) * dt;
    }
    this.value = Math.max(0, Math.min(100, this.value));
    this.peak = Math.max(this.peak, this.value);
    let s = 0;
    for (let i = 0; i < DREAD.stages.length; i++) if (this.value >= DREAD.stages[i].at) s = i;
    if (s > this.stage) {
      this.stage = s;
      this.log.push({ t: +this.time.toFixed(1), stage: s, name: DREAD.stages[s].name, value: +this.value.toFixed(1) });
      this.notify(DREAD.stages[s].note);
    }
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.samples.push({ t: Math.floor(this.time), v: +this.value.toFixed(2), stage: this.stage });
    this.applyEffects(dt);
  }

  /** The consequences: fog, fear rates, the creature's boldness, the torch at Dread. */
  applyEffects(dt) {
    const k = this.level;
    // Fog: linear fog's far distance shrinks; exponential night fog (FogExp2) gets denser by the
    // same factor. The base is taken from whatever fog the map ended up with.
    const f = this.scene.fog;
    if (f && f !== this.fogObj) { this.fogObj = f; this.fogBase = f.isFogExp2 ? f.density : f.far; }
    const shrink = 1 - (1 - DREAD.fogFarMin) * k;
    if (f?.isFogExp2) f.density = this.fogBase / shrink;
    else if (f) f.far = this.fogBase * shrink;
    this.sightShare = shrink;                      // share of the normal seeing distance left (checks, status)
    // Fear builds on dread: it rises faster (its rates are scaled live).
    if (this.fear) this.fear.dreadMul = 1 + (DREAD.fearMul - 1) * k;
    // The creature gets bolder: +1 escalation level at Hunted, +2 at Dread (capped at 3).
    for (const c of this.getThreats()) {
      if (!this.baseLevels.has(c)) this.baseLevels.set(c, c.level ?? 1);
      const want = Math.min(3, this.baseLevels.get(c) + (this.stage >= 2 ? 1 : 0) + (this.stage >= 3 ? 1 : 0));
      if (c.level !== want) { c.level = want; this.log.push({ t: +this.time.toFixed(1), emboldened: c.profile?.name ?? 'cryptid', level: want }); }
    }
    // At Dread the torch stutters for a moment every so often (a real dip in your light).
    if (this.stage >= 3 && this.flashlight.on) {
      this.flicker -= dt;
      if (this.flicker <= -7 + 3 * Math.sin(this.time * 0.7)) this.flicker = 0.35;
      this.flashlight.dreadDim = this.flicker > 0 ? 0.25 : 1;
    } else this.flashlight.dreadDim = 1;
  }

  // ---- presentation (#131): dread shows only in the world, never as a meter -----------------------
  // No bar and no screen overlay. You hear it (breathing, heartbeat: buildDreadAudio), you see it in
  // your hands (tremor on the held tools: main reads `feedback.tremor`), and a short label says so
  // while it affects you. The label, the tremor and the sounds all come from dreadFeedback(), so the
  // label can never claim an effect that isn't happening (the UI never lies).
  get feedback() { return dreadFeedback(this.value); }

  buildOverlay() {
    const l = this.label = document.createElement('div');
    l.id = 'shaken-label';
    Object.assign(l.style, { position: 'fixed', left: '12px', bottom: '112px', font: '13px monospace', color: '#e8d8c8', textShadow: '0 0 3px #000',
      pointerEvents: 'none', opacity: '0', transition: 'opacity 0.8s' });
    document.body.append(l);
  }

  render() {
    const f = this.feedback;
    if (f.label && this.label.textContent !== f.label) this.label.textContent = f.label;
    this.label.style.opacity = f.label ? '1' : '0';
    this.labelShown = !!f.label;
  }
}

/** The level dread starts to affect you (the label, tremor and breathing all start here). */
export const DREAD_FEEDBACK_AT = 25;

/**
 * What dread at `value` (0-100) does to how you feel, all from one place:
 *   tremor  0..1  hand tremor on held tools (never the camera)
 *   breath  0..1  how loud and fast your breathing is
 *   heart   0..1  heartbeat loudness
 *   label   the concise status line, or null while dread isn't affecting you
 */
export function dreadFeedback(value) {
  const on = value >= DREAD_FEEDBACK_AT;
  const amt = on ? Math.min(1, (value - DREAD_FEEDBACK_AT) / (100 - DREAD_FEEDBACK_AT)) : 0;
  return {
    on,
    tremor: on ? 0.25 + 0.75 * amt : 0,
    breath: on ? 0.3 + 0.7 * amt : 0,
    heart: on ? 0.2 + 0.8 * amt : 0,
    label: !on ? null : value >= 75 ? 'Badly shaken: hands trembling, breathing ragged' : 'Shaken: hands unsteady, breathing loud',
  };
}

/**
 * The night's soundscape (WebAudio): a chorus of crickets that thins and dies as dread rises,
 * a low wind, and a heartbeat that comes up under it and quickens. Works on an AudioContext or an
 * OfflineAudioContext (for recording clips). set(k) moves everything to dread level k (0..1).
 */
export function buildDreadAudio(ctx, dest = ctx.destination) {
  const master = ctx.createGain(); master.gain.value = 0.6; master.connect(dest);
  // Crickets: pulsed high band-passed noise.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); let seed = 7;
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };
  const cr = noise(), crBp = ctx.createBiquadFilter(); crBp.type = 'bandpass'; crBp.frequency.value = 4400; crBp.Q.value = 18;
  const crPulse = ctx.createGain(); crPulse.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.5;
  lfo.connect(lfoAmt).connect(crPulse.gain);
  const crVol = ctx.createGain(); crVol.gain.value = 0.5;
  cr.connect(crBp).connect(crPulse).connect(crVol).connect(master);
  // Wind: low-passed noise.
  const wind = noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const windVol = ctx.createGain(); windVol.gain.value = 0.25;
  wind.connect(lp).connect(windVol).connect(master);
  // Heartbeat: a low sine thump, retriggered by a scheduler.
  const heartVol = ctx.createGain(); heartVol.gain.value = 0; heartVol.connect(master);
  // Breathing (#131): your own breath, close and band-passed, each breath shaped in by the scheduler;
  // louder and quicker the more dread affects you (dreadFeedback().breath).
  const breathSrc = noise(), breathBp = ctx.createBiquadFilter(); breathBp.type = 'bandpass'; breathBp.frequency.value = 900; breathBp.Q.value = 0.9;
  const breathEnv = ctx.createGain(); breathEnv.gain.value = 0;
  const breathVol = ctx.createGain(); breathVol.gain.value = 0;
  breathSrc.connect(breathBp).connect(breathEnv).connect(breathVol).connect(master);
  breathSrc.start();
  cr.start(); wind.start(); lfo.start();
  let k = 0, fb = dreadFeedback(0), next = ctx.currentTime + 0.2, nextBreath = ctx.currentTime + 0.3;
  const breath = (t, len) => {   // in (rising hiss), a pause, out (longer, softer)
    const g = breathEnv.gain;
    g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.9, t + len * 0.35); g.linearRampToValueAtTime(0.05, t + len * 0.45);
    g.linearRampToValueAtTime(0.6, t + len * 0.6); g.linearRampToValueAtTime(0.0001, t + len);
  };
  const thump = (t, amp) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(heartVol); o.start(t); o.stop(t + 0.25);
  };
  const schedule = (until) => {
    while (next < until) {
      const bpm = 58 + 70 * k;
      if (fb.heart > 0) { thump(next, 0.9); thump(next + 0.24, 0.6); }
      next += 60 / bpm;
    }
    while (nextBreath < until) {
      const len = 4.2 - 2.4 * fb.breath;               // calm ~4 s a breath; badly shaken ~1.8 s
      if (fb.breath > 0) breath(nextBreath, len);
      nextBreath += len;
    }
  };
  return {
    set(level, at = ctx.currentTime) {
      k = Math.max(0, Math.min(1, level));
      fb = dreadFeedback(k * 100);
      crVol.gain.setTargetAtTime(0.5 * Math.max(0, 1 - k * 1.6), at, 1.2);    // the chorus is gone by ~60% dread
      windVol.gain.setTargetAtTime(0.25 + 0.15 * k, at, 1.5);
      heartVol.gain.setTargetAtTime(fb.heart * 0.9, at, 1.0);
      breathVol.gain.setTargetAtTime(fb.breath * 0.55, at, 0.8);
    },
    tick(ahead = 0.5) { schedule(ctx.currentTime + ahead); },
    get feedback() { return fb; },          // what the sound is doing now (checks: the label matches it)
    scheduleUntil: schedule,
    master,
  };
}

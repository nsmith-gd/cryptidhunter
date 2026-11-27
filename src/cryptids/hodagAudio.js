// Hodag sounds (#142), synthesised with WebAudio so they need no files: a rattling growl (the boundary
// warning), a bellowing roar (it charges), heavy footfalls (charging / pursuing) and a snort (it gives
// up and turns home). Panned left/right by where it is relative to your view and quieter with distance.
// Every sound is also logged (and captioned by the caller), so it's never the only cue.

export class HodagAudio {
  constructor() { this.ctx = null; this.log = []; }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch { this.ctx = null; }
    return this.ctx;
  }

  /** kind: growl | roar | thud | snort. pan -1..1 (left..right), distance in metres. */
  play(kind, { pan = 0, distance = 10, t = 0 } = {}) {
    this.log.push({ kind, t: +t.toFixed(2), distance: +distance.toFixed(1) });
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
    const now = ctx.currentTime + 0.01, vol = Math.min(1, 12 / Math.max(4, distance));
    const out = ctx.createGain(); out.gain.value = vol;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(panner).connect(ctx.destination); } else out.connect(ctx.destination);
    const noise = (secs) => {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf; return src;
    };
    const env = (g, a, peak, len) => { g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(peak, now + a); g.gain.exponentialRampToValueAtTime(0.0001, now + len); };
    if (kind === 'growl') {
      // A low saw, rattled by a fast tremolo and muffled: a throaty, clicking growl.
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(58, now); o.frequency.linearRampToValueAtTime(48, now + 1.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const trem = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.frequency.value = 17; const depth = ctx.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(trem.gain); trem.gain.value = 0.5;
      const g = ctx.createGain(); env(g, 0.15, 0.9, 1.4);
      o.connect(lp).connect(trem).connect(g).connect(out);
      o.start(now); lfo.start(now); o.stop(now + 1.5); lfo.stop(now + 1.5);
    } else if (kind === 'roar') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, now); o.frequency.exponentialRampToValueAtTime(55, now + 1.1);
      const n = noise(1.2), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.8;
      const g = ctx.createGain(); env(g, 0.05, 1, 1.2);
      o.connect(g); n.connect(bp).connect(g); g.connect(out);
      o.start(now); n.start(now); o.stop(now + 1.25); n.stop(now + 1.25);
    } else if (kind === 'thud') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(35, now + 0.18);
      const g = ctx.createGain(); env(g, 0.005, 0.9, 0.22);
      o.connect(g).connect(out); o.start(now); o.stop(now + 0.25);
    } else if (kind === 'snort') {
      const n = noise(0.4), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5;
      const g = ctx.createGain(); env(g, 0.03, 0.7, 0.38);
      n.connect(bp).connect(g).connect(out); n.start(now); n.stop(now + 0.4);
    }
  }
}

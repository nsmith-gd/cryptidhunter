import * as THREE from 'three';
import { stream } from '../core/rng.js';

// Wood-knock call and response (Bigfoot L1).
// Any cryptid whose profile has clues.woodKnock knocks on a tree every so often (a hollow
// "tok... tok-tok" you hear from far off, panned toward where it is). Press K to knock back
// with your knock stick: a cryptid that's listening answers with its own knocks, then walks
// closer to investigate, stopping a cautious distance short of you. Answering soon after it
// knocked always works; knocking out of the blue only sometimes gets a reply.
export const KNOCK = {
  key: 'KeyK',
  hearRange: 110,          // metres: how far a knock carries (both ways)
  answerWindow: 45,        // seconds after its own knock that it's sure to answer you
  coldAnswerChance: 0.35,  // chance it answers a knock you start yourself
  replyDelay: [1.2, 2.6],  // seconds before it knocks back
  approachTo: 22,          // it comes to about this far from where you knocked (outside its flee range)
  playerCooldown: 2.5,     // seconds between your knocks
  pullCooldown: 12,        // after answering, it won't be pulled again for this long
  scare: 6,                // fear spike when you hear it knock nearby (scaled by distance)
};

export class WoodKnocks {
  constructor({ cryptids, player, camera, fear = null, input = null, rand = stream('woodKnock') }) {
    this.cryptids = cryptids;
    this.player = player;
    this.camera = camera;
    this.fear = fear;
    this.input = input;
    this.rand = rand;
    this.state = new Map();      // cryptid -> { next, lastKnock, pullCooldown }
    this.pending = [];           // scheduled replies { cryptid, at }
    this.time = 0;
    this.playerCooldown = 0;
    this.log = [];               // { t, who: 'player' | name, x, z, kind }
    this.audio = new KnockAudio();
    this.buildCaption();
    addEventListener('keydown', (e) => {
      if (e.code === KNOCK.key && !e.repeat && (!this.input || this.input.locked)) this.playerKnock();
    });
  }

  knockers() { return this.cryptids.cryptids.filter((c) => c.profile.clues?.woodKnock); }

  stateOf(c) {
    if (!this.state.has(c)) this.state.set(c, { next: this.interval(c), lastKnock: null, pullCooldown: 0 });
    return this.state.get(c);
  }

  interval(c) {
    const [lo, hi] = c.profile.clues.woodKnock.intervalSeconds;
    return lo + this.rand() * (hi - lo);
  }

  update(dt) {
    this.time += dt;
    this.playerCooldown = Math.max(0, this.playerCooldown - dt);
    for (const c of this.knockers()) {
      const s = this.stateOf(c);
      s.pullCooldown = Math.max(0, s.pullCooldown - dt);
      s.next -= dt;
      // It only knocks while calm (not while running from you or charging).
      if (s.next <= 0) {
        if (c.state === 'roam' || c.state === 'investigate') this.cryptidKnock(c, 'call');
        s.next = this.interval(c);
      }
    }
    for (const p of this.pending.filter((p) => p.at <= this.time)) {
      this.pending.splice(this.pending.indexOf(p), 1);
      this.answer(p.cryptid, p.spot);
    }
    this.updateCaption(dt);
  }

  /** The cryptid bangs on a tree where it stands. */
  cryptidKnock(c, kind = 'call') {
    const s = this.stateOf(c);
    s.lastKnock = { x: c.agent.x, z: c.agent.z, t: this.time };
    this.log.push({ t: this.time, who: c.profile.name, x: c.agent.x, z: c.agent.z, kind });
    const p = this.player.position, d = Math.hypot(c.agent.x - p.x, c.agent.z - p.z);
    const count = kind === 'reply' ? 2 : 1 + Math.floor(this.rand() * 3);
    // It stops and clubs a trunk (seen even out of earshot); each knock lands on a strike.
    c.mesh.userData.play?.('knock', { count });
    if (c.mesh.userData.play) c.agent.stop();
    if (d > KNOCK.hearRange) return;
    // The first knock sounds on the strike animation's contact frame; the rest follow every gap.
    const kt = c.mesh.userData.knockTiming;
    const lead = kt ? kt.windup + (kt.contact ?? 0) * kt.gap : 0;
    this.audio.knock({ count, distance: d, pan: this.panTo(c.agent.x, c.agent.z), heavy: true, delay: lead });
    this.fear?.scare(KNOCK.scare * (1 - d / KNOCK.hearRange), 'wood knock');
    this.showCaption(`${kind === 'reply' ? 'Knocks answer you' : 'A wood knock'}: ${'KNOCK '.repeat(count).trim()} (${this.describe(c.agent.x, c.agent.z, d)})`);
  }

  /** You knock with your stick. Listening cryptids may answer and come closer. */
  playerKnock() {
    if (this.playerCooldown > 0) return false;
    this.playerCooldown = KNOCK.playerCooldown;
    const p = this.player.position;
    const spot = { x: p.x, z: p.z };
    this.log.push({ t: this.time, who: 'player', x: p.x, z: p.z, kind: 'player' });
    this.audio.knock({ count: 2, distance: 1, pan: 0, heavy: false });
    this.showCaption('You knock: KNOCK KNOCK');
    for (const c of this.knockers()) {
      const s = this.stateOf(c);
      const d = Math.hypot(c.agent.x - p.x, c.agent.z - p.z);
      if (d > KNOCK.hearRange || s.pullCooldown > 0) continue;
      if (!(c.state === 'roam' || c.state === 'investigate')) continue;
      const recent = s.lastKnock && this.time - s.lastKnock.t <= KNOCK.answerWindow;
      if (!recent && this.rand() > KNOCK.coldAnswerChance) continue;
      const [lo, hi] = KNOCK.replyDelay;
      this.pending.push({ cryptid: c, spot, at: this.time + lo + this.rand() * (hi - lo) });
      s.pullCooldown = KNOCK.pullCooldown;
    }
    return true;
  }

  // Knock back, then head toward where you knocked, stopping short of you.
  answer(c, spot) {
    if (!(c.state === 'roam' || c.state === 'investigate')) return;
    this.cryptidKnock(c, 'reply');
    const dx = c.agent.x - spot.x, dz = c.agent.z - spot.z, d = Math.hypot(dx, dz) || 1;
    if (d <= KNOCK.approachTo) return;   // already close: it just answers
    const goal = { x: spot.x + (dx / d) * KNOCK.approachTo, z: spot.z + (dz / d) * KNOCK.approachTo };
    if (c.enterInvestigateNoise) c.enterInvestigateNoise(goal, 'answered your knock');
  }

  panTo(x, z) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    const to = new THREE.Vector3(x - this.camera.position.x, 0, z - this.camera.position.z).normalize();
    return THREE.MathUtils.clamp(right.dot(to), -1, 1);
  }

  describe(x, z, d) {
    const p = this.player.position;
    const a = Math.atan2(x - p.x, -(z - p.z));   // 0 = north (-z), clockwise
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const dir = dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
    const far = d < 25 ? 'close' : d < 60 ? 'not far' : 'far off';
    return `${far}, to the ${dir}`;
  }

  buildCaption() {
    const el = this.caption = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', top: '44px', left: '50%', transform: 'translateX(-50%)', font: '13px monospace',
      color: '#e8dcc0', textShadow: '0 0 3px #000', pointerEvents: 'none', opacity: '0', transition: 'opacity .4s', whiteSpace: 'nowrap' });
    document.body.appendChild(el);
    this.captionLeft = 0;
  }

  showCaption(text) { this.caption.textContent = text; this.caption.style.opacity = '1'; this.captionLeft = 4; }

  updateCaption(dt) {
    if (this.captionLeft <= 0) return;
    this.captionLeft -= dt;
    if (this.captionLeft <= 0) this.caption.style.opacity = '0';
  }
}

// Recorded knocks: 5 dry, normalised CC0 wood hits per weight (Kenney "Impact Sounds"; source,
// author and licence in public/audio/knock/CREDITS.md). Bigfoot and your knock stick use the same
// set: Bigfoot's are the heavy hits pitched down with a forest echo, yours are the medium hits.
// Distance (duller + quieter), pan, pitch and echo are all applied at playback.
// If the files can't load, a synthesised wood knock is used instead (also used by tests).
const KNOCK_FILES = {
  heavy: [0, 1, 2, 3, 4].map((i) => `audio/knock/knock-heavy-${i}.ogg`),
  light: [0, 1, 2, 3, 4].map((i) => `audio/knock/knock-medium-${i}.ogg`),
};

/** Fetch and decode the knock recordings once (works with live and offline contexts). */
export async function loadKnockBuffers(ctx, base = import.meta.env?.BASE_URL ?? '/') {
  const load = async (url) => {
    const res = await fetch(base + url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  };
  const [heavy, light] = await Promise.all([Promise.all(KNOCK_FILES.heavy.map(load)), Promise.all(KNOCK_FILES.light.map(load))]);
  return { heavy, light };
}

export class KnockAudio {
  constructor() {
    this.ctx = null;
    this.buffers = null;
    this.mode = 'loading';      // loading | recorded | synth
    const unlock = () => { this.ensure(); this.ctx?.resume?.(); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch { this.ctx = null; return null; }
    loadKnockBuffers(this.ctx).then((b) => { this.buffers = b; this.mode = 'recorded'; }).catch(() => { this.buffers = null; this.mode = 'synth'; });
    return this.ctx;
  }

  knock(opts) {
    const ctx = this.ensure();
    if (!ctx) return;
    // Still loading or unavailable: fall back to the synthesised knock so a knock is never silent.
    scheduleKnocks(ctx, ctx.destination, ctx.currentTime + 0.02 + (opts.delay ?? 0), { ...opts, buffers: this.buffers });
  }
}

/** Schedule `count` knocks into `dest`. Uses the recordings when `buffers` is given, else synthesis. */
export function scheduleKnocks(ctx, dest, t0, { count = 2, distance = 1, pan = 0, heavy = true, buffers = null }) {
  const gain = Math.min(1, 8 / Math.max(8, distance)) * (heavy ? 1 : 0.7);
  const cutoff = 9000 * Math.max(0.08, 1 - distance / 130);       // far knocks lose their crack
  const out = ctx.createGain();
  out.gain.value = gain;
  let node = out;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
  node.connect(dest);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
  lp.connect(out);
  // Forest echo: a short feedback delay, stronger on Bigfoot's heavy knocks.
  const wet = ctx.createGain(); wet.gain.value = heavy ? 0.32 : 0.16;
  const delay = ctx.createDelay(1); delay.delayTime.value = heavy ? 0.19 : 0.13;
  const fb = ctx.createGain(); fb.gain.value = 0.35;
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 1800;
  lp.connect(wet).connect(delay).connect(damp).connect(fb).connect(delay);
  damp.connect(out);

  const gap = heavy ? 0.62 : 0.34;
  let last = -1;
  for (let i = 0; i < count; i++) {
    const t = t0 + i * gap * (heavy ? 1 : 0.92 + Math.random() * 0.16);   // heavy knocks keep time with the strike animation
    if (buffers) {
      const set = heavy ? buffers.heavy : buffers.light;
      let k = Math.floor(Math.random() * set.length);
      if (k === last) k = (k + 1) % set.length;              // never the same take twice in a row
      last = k;
      const src = ctx.createBufferSource();
      src.buffer = set[k];
      src.playbackRate.value = (heavy ? 0.8 : 1) * (0.96 + Math.random() * 0.08);   // bigger tree, lower tok
      src.connect(lp);
      src.start(t);
    } else synthKnock(ctx, lp, t, heavy);
  }
}

/** Fallback wood knock: a short noisy strike plus a damped body with a few inharmonic partials. */
export function synthKnock(ctx, dest, t, heavy = true) {
  const base = (heavy ? 210 : 330) * (0.95 + Math.random() * 0.1);
  const decay = heavy ? 0.16 : 0.1;
  for (const [ratio, amp] of [[1, 0.8], [1.58, 0.45], [2.31, 0.3], [3.17, 0.15]]) {   // wood: inharmonic modes
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * ratio, t);
    osc.frequency.exponentialRampToValueAtTime(base * ratio * 0.97, t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / ratio * 1.4);
    osc.connect(g).connect(dest);
    osc.start(t); osc.stop(t + decay * 1.5);
  }
  const len = Math.floor(ctx.sampleRate * 0.025);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let k = 0; k < len; k++) data[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 6);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 1600 : 2400; bp.Q.value = 0.9;
  const ng = ctx.createGain(); ng.gain.value = 0.6;
  src.connect(bp).connect(ng).connect(dest);
  src.start(t);
}

WoodKnocks.scheduleKnocks = scheduleKnocks;   // for tools that render the sounds offline
WoodKnocks.loadKnockBuffers = loadKnockBuffers;
WoodKnocks.synthKnock = synthKnock;

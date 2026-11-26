// WebXR entry point and safe pause (GDD 16.1, 16.3).
//  · Support check at launch: secure context + navigator.xr + isSessionSupported('immersive-vr').
//    The "Enter VR" button only appears when all three hold; desktop play is untouched otherwise.
//  · Enter only on a user gesture; rejection is handled gracefully (message, stay on desktop).
//  · Rendering uses the renderer's animation loop, which runs on XRSession.requestAnimationFrame
//    while presenting. Floor-relative ('local-floor') reference space when available, else 'local'.
//  · Safe pause: leaving VR, the headset going hidden/blurred (removed, system menu), tracking loss,
//    or the desktop tab being hidden pauses the simulation (no time passes: no hunger, no dawn
//    clock, no cryptid moves). No penalty from technical interruptions.
export const XR_OPTIONAL = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'];
const TRACKING_GRACE = 1.0;   // seconds of good tracking before an automatic resume

export class PauseState {
  constructor(onChange = () => {}) { this.reasons = new Map(); this.onChange = onChange; }
  get paused() { return this.reasons.size > 0; }
  /** reason: short id; text: what the player sees; userResume: a click clears it */
  pause(reason, text, userResume = false) {
    const was = this.paused, had = this.reasons.has(reason);
    this.reasons.set(reason, { text, userResume });
    if (!was || !had) this.onChange(this);
  }
  resume(reason) { if (this.reasons.delete(reason)) this.onChange(this); }
  resumeByUser() {
    let changed = false;
    for (const [k, r] of this.reasons) if (r.userResume) { this.reasons.delete(k); changed = true; }
    if (changed) this.onChange(this);
  }
  get text() { return [...this.reasons.values()].map((r) => r.text).join(' · '); }
}

export class WebXRPresenter {
  /**
   * @param {object} o { renderer, xr = navigator.xr, secure = isSecureContext, doc = document,
   *   pause: PauseState, onEnter(), onExit(), notify(msg) }
   */
  constructor({ renderer, xr = globalThis.navigator?.xr, secure = globalThis.isSecureContext, doc = globalThis.document, pause, onEnter = () => {}, onExit = () => {}, notify = () => {} }) {
    this.renderer = renderer;
    this.xr = xr;
    this.secure = !!secure;
    this.doc = doc;
    this.pause = pause;
    this.onEnter = onEnter;
    this.onExit = onExit;
    this.notify = notify;
    this.supported = false;
    this.session = null;
    this.refSpaceType = null;
    this.goodTracking = 0;
    this.buttons = [];
    renderer.xr.enabled = true;
  }

  get presenting() { return !!this.session && this.renderer.xr.isPresenting !== false; }

  /** Feature-detect immersive VR. Never throws. */
  async detect() {
    this.supported = false;
    try {
      if (this.secure && this.xr && typeof this.xr.isSessionSupported === 'function') {
        this.supported = !!(await this.xr.isSessionSupported('immersive-vr'));
      }
    } catch { this.supported = false; }
    for (const b of this.buttons) b.style.display = this.supported ? '' : 'none';
    return this.supported;
  }

  /** "Enter VR" buttons: one on the start screen, one in the corner. Hidden until supported. */
  mountButtons(roots) {
    for (const root of roots) {
      if (!root) continue;
      const b = document.createElement('button');
      b.className = 'enter-vr';
      b.textContent = 'Enter VR';
      Object.assign(b.style, { display: 'none', font: '14px monospace', padding: '8px 14px', margin: '8px auto', cursor: 'pointer',
        background: '#1d2a22', color: '#cfe8d4', border: '1px solid #6a9a78' });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.enter(); });
      root.prepend(b);   // top of the start screen, above the camp panels
      this.buttons.push(b);
    }
  }

  /** Enter immersive VR. Must be called from a user gesture (click). */
  async enter() {
    if (!this.supported || this.session) return false;
    let session;
    try {
      session = await this.xr.requestSession('immersive-vr', { optionalFeatures: XR_OPTIONAL });
    } catch (e) {
      this.notify(`VR could not start (${e?.name ?? 'refused'}). You can keep playing on desktop.`);
      return false;
    }
    // Floor-relative space when the runtime has one, else a local space (calibrated at eye height).
    this.refSpaceType = 'local';
    try { await session.requestReferenceSpace('local-floor'); this.refSpaceType = 'local-floor'; } catch { /* fall back */ }
    try {
      this.renderer.xr.setReferenceSpaceType(this.refSpaceType);
      await this.renderer.xr.setSession(session);
    } catch (e) {
      this.notify('VR could not start on this device. You can keep playing on desktop.');
      try { await session.end(); } catch { /* already gone */ }
      return false;
    }
    this.session = session;
    session.addEventListener('end', () => this.handleEnd());
    session.addEventListener('visibilitychange', () => this.handleVisibility());
    this.pause.resume('left-vr');
    this.onEnter(this);
    return true;
  }

  async exit() { try { await this.session?.end(); } catch { /* ignore */ } }

  handleEnd() {
    this.session = null;
    this.pause.resume('headset');
    this.pause.resume('tracking');
    this.pause.pause('left-vr', 'Paused: you left VR. Click to carry on at the desk.', true);
    this.onExit(this);
  }

  handleVisibility() {
    const v = this.session?.visibilityState;
    if (v && v !== 'visible') this.pause.pause('headset', 'Paused: headset off or system menu open.');
    else this.pause.resume('headset');
  }

  /** Call once per frame with the XRFrame (null on desktop): watches for tracking loss. */
  onFrame(frame, dt = 0) {
    if (!this.session || !frame) return;
    const space = this.renderer.xr.getReferenceSpace?.();
    let pose = null;
    try { pose = space ? frame.getViewerPose(space) : null; } catch { pose = null; }
    if (!pose) { this.goodTracking = 0; this.pause.pause('tracking', 'Paused: tracking lost. Look around a well-lit room.'); return; }
    this.goodTracking += dt;
    if (this.goodTracking >= TRACKING_GRACE) this.pause.resume('tracking');
  }

  /** Desktop: pause while the tab is hidden; resume when it comes back. */
  watchPage() {
    this.doc?.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') this.pause.pause('tab', 'Paused: the game was in the background.');
      else this.pause.resume('tab');
    });
  }
}

/** Pause screen: shows why the game is paused; click clears the reasons a click can clear. */
export function mountPauseScreen(pause, root = document.body) {
  const el = document.createElement('div');
  el.id = 'pause-screen';
  Object.assign(el.style, { position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.72)', color: '#e8e4d8', font: '18px monospace', textAlign: 'center', zIndex: '30', cursor: 'pointer', padding: '20px' });
  root.append(el);
  el.addEventListener('click', () => pause.resumeByUser());
  const render = () => { el.style.display = pause.paused ? 'flex' : 'none'; el.textContent = `PAUSED\n${pause.text}`; el.style.whiteSpace = 'pre-line'; };
  const prev = pause.onChange;
  pause.onChange = (p) => { prev(p); render(); };
  render();
  return el;
}

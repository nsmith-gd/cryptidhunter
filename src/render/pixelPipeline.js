// Pixel render pipeline (art #35): the 3D pixel-art look and what keeps it stable in motion.
//
// 1. Low-res target. The WebGL canvas's drawing buffer IS the low-res render target: about
//    TARGET_ROWS rows tall (640x360 at 1080p, per docs/art-style-guide.md), with no antialiasing.
//    Post passes (night vision, later colour grading) run at this resolution too.
// 2. Point-filtered upscale by an exact integer. The canvas is displayed at `scale` device pixels
//    per render pixel (CSS size = buffer * scale / devicePixelRatio, `image-rendering: pixelated`),
//    so every pixel is the same size on screen. A non-integer stretch (the old 100vw x 100vh) makes
//    some pixels 3 screen-pixels wide and others 4, and that pattern crawls as you move: shimmer.
//    Any leftover (< one pixel per side) is letterboxed in black, centred.
// 3. Stable pixel snapping. While a frame renders, the camera's yaw and pitch are snapped to
//    multiples of one render pixel's angle, then restored (gameplay always sees the true aim).
//    Turning the view (or the fear / comfort sway) then shifts the image a whole pixel at a time
//    instead of re-sampling every edge at sub-pixel offsets, which is what makes edges crawl.
//    Position is not snapped: in first person, snapping translation makes near walls jump
//    several pixels per step; walking parallax is expected and stays smooth.
//
// URL overrides for testing: ?rows=N (target rows), ?scale=N (force the integer scale), ?nosnap.

export const TARGET_ROWS = 360;

export class PixelPipeline {
  constructor({ renderer, camera, rows = TARGET_ROWS, snap = true, scale = null }) {
    this.renderer = renderer;
    this.camera = camera;
    const q = new URLSearchParams(location.search);
    this.rows = Number(q.get('rows')) || rows;
    this.forcedScale = Number(q.get('scale')) || scale;
    this.snap = snap && !q.has('nosnap');
    this.scale = 1;
    this.width = 1;
    this.height = 1;
    this.listeners = new Set();
    const c = renderer.domElement;
    Object.assign(c.style, { position: 'fixed', imageRendering: 'pixelated', margin: '0' });
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Called with (width, height, scale) after every resize (for systems with their own targets). */
  onResize(fn) { this.listeners.add(fn); fn(this.width, this.height, this.scale); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const dw = Math.round(innerWidth * dpr), dh = Math.round(innerHeight * dpr);
    const scale = Math.max(1, this.forcedScale || Math.round(dh / this.rows));
    const w = Math.max(1, Math.floor(dw / scale)), h = Math.max(1, Math.floor(dh / scale));
    this.scale = scale; this.width = w; this.height = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    const c = this.renderer.domElement;
    // Exact device-pixel size and offset, expressed in CSS pixels.
    const ox = Math.floor((dw - w * scale) / 2), oy = Math.floor((dh - h * scale) / 2);
    Object.assign(c.style, {
      width: `${(w * scale) / dpr}px`, height: `${(h * scale) / dpr}px`,
      left: `${ox / dpr}px`, top: `${oy / dpr}px`,
    });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const fn of this.listeners) fn(w, h, scale);
  }

  /** Angle of one render pixel at the centre of the view (radians). */
  get pixelAngle() {
    return (this.camera.fov * Math.PI / 180) / this.height;
  }

  /**
   * Render one frame: snaps the camera for the duration of draw(), then restores it.
   * draw() does the actual rendering (scene, night vision, post passes).
   */
  frame(draw) {
    const cam = this.camera;
    if (!this.snap) { draw(); return; }
    const rx = cam.rotation.x, ry = cam.rotation.y, rz = cam.rotation.z, order = cam.rotation.order;
    const step = this.pixelAngle;
    cam.rotation.order = 'YXZ';
    // Snap in the player's own yaw/pitch space (main camera uses YXZ: pitch about X, yaw about Y).
    cam.rotation.set(Math.round(rx / step) * step, Math.round(ry / step) * step, rz, 'YXZ');
    cam.updateMatrixWorld(true);
    try {
      draw();
    } finally {
      cam.rotation.set(rx, ry, rz, order);
      cam.updateMatrixWorld(true);
    }
  }
}

// Gym G00 runner (#77, GDD 15.2 / 13.2 / 14.2): plays one fixed script of player input through
// the real game loop (simulate + present + render, frame by frame) and records what gameplay
// produced: every AI perception and state change, cryptid events, photo evidence and journal
// evidence. Run with the same seed under different pixel / render settings and the records
// must be identical: render settings never change AI or evidence (they only change pixels).
//
// Usage (in the browser console or a test): load ?map=gym&seed=77&simpaused, then
// window.__gym.run() -> { frames, record, digest }.

export const G00_FRAMES = 720;   // 24 s at 30 fps

const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
const clean = (o, drop = []) => JSON.parse(JSON.stringify(o, (k, v) => (drop.includes(k) ? undefined : r6(v))));

/** Aim the player at a point (what a player does with the mouse; derived from game state only). */
function aimAt(p, x, y, z) {
  const dx = x - p.position.x, dz = z - p.position.z, dy = y - (p.position.y + 1.68);
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

const key = (code) => { dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); };
const mouse = (button, type) => dispatchEvent(new MouseEvent(type, { button, bubbles: true }));

/** The script: what the player does on each frame. Inputs only; no peeking at render output. */
function scriptFrame(g, f) {
  const { input, player } = g;
  const hold = (codes) => { input.keys.clear(); for (const c of codes) input.keys.add(c); };
  if (f === 2) key('KeyF');                                        // equip / switch on the light
  if (f >= 5 && f < 150) hold(['KeyW']);                           // walk out through the bright doorway
  if (f >= 30 && f < 150 && f % 20 === 0) input.mouseDX += 6;      // look around a little while walking
  if (f === 150) { hold([]); const c = g.clues.clues.filter((x) => !x.found).sort((a, b) => Math.hypot(a.x - player.position.x, a.z - player.position.z) - Math.hypot(b.x - player.position.x, b.z - player.position.z))[0]; if (c) { player.position.set(c.x, 0, c.z + 1.1); aimAt(player, c.x, c.y, c.z); } }
  if (f === 152) key('KeyE');                                      // examine the clue
  if (f >= 160 && f < 330) hold(f % 60 < 40 ? ['KeyW'] : ['KeyW', 'ShiftLeft']);   // head for the creature, sometimes running
  if (f === 330) hold(['ControlLeft']);                            // crouch and watch
  const b = g.cryptids.cryptids[0];
  if (f >= 330 && f < 470 && b) aimAt(player, b.agent.x, 2.2, b.agent.z);
  if (f === 340) mouse(2, 'mousedown');                            // raise the camera
  if (f === 380 || f === 420 || f === 460) { mouse(0, 'mousedown'); mouse(0, 'mouseup'); }   // three photos
  if (f === 470) { mouse(2, 'mouseup'); hold([]); }
  if (f === 480) key('KeyF');                                      // light off: read the dark
  if (f >= 485 && f < 560) hold(['KeyS']);
  if (f === 560) key('KeyF');                                      // light on again
  if (f >= 565 && f < 700) hold(f % 50 < 25 ? ['KeyA', 'KeyW'] : ['KeyD', 'KeyW']);
  if (f === 700) hold([]);
}

export function runG00(g, { frames = G00_FRAMES } = {}) {
  const { sim, input, hunt } = g;
  input.locked = true;
  g.overlay?.classList.add('hidden');
  hunt.start();
  if (g.huntFailure) g.huntFailure.enabled = false;               // the bench never ends the run
  const record = { perception: [], states: [], events: [], player: [] };
  const last = new Map();
  for (let f = 0; f < frames; f++) {
    scriptFrame(g, f);
    sim.frame(1 / 30);                                             // simulate + present + render
    for (const c of g.cryptids.cryptids) {
      const p = c.perception;
      const snap = p ? [r6(p.hearLevel), r6(p.sightLevel), r6(p.beamLevel), r6(p.awareness), p.detected] : null;
      const key2 = JSON.stringify([c.state, snap]);
      if (last.get(c) !== key2) { record.perception.push({ f, who: c.profile.id, state: c.state, p: snap }); last.set(c, key2); }
    }
    if (f % 30 === 0) record.player.push([f, r6(g.player.position.x), r6(g.player.position.z), r6(g.player.stamina)]);
  }
  record.events = g.cryptidEvents.map((e) => clean(e, ['t']));
  record.photos = g.photo.log.map((e) => clean(e, ['at', 'image', 'thumb', 'dataUrl', 'canvas']));
  record.journal = g.journal.entries.map((e) => clean(e, ['at', 'time', 'loggedAt', 'object']));
  record.hunt = { stage: hunt.stage, photos: hunt.photos.length, best: hunt.photo?.score ?? null };
  const text = JSON.stringify(record);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return { frames, record, digest: h.toString(16), size: text.length };
}

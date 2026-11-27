import * as THREE from 'three';

// G09 finale rehearsal fixture (GDD §15.2 G09 "separate short finale fixture with water crossing,
// base, final commitment and authored ending"; §11.2; task #155). Greybox, proxy art. ?map=g09.
// No new mechanics: the river is the existing wading (shallow ford, slow deep water), the base is
// a finite cache, the ending is an authored state change.
//   Layout (north = -z): the trailhead and the last extraction point in the south; a river across
//   the middle with one shallow ford; the base (a tent and a supply cache that never restocks) on
//   the far bank; the final site - a ring of standing stones - in the north.
//   Before the commitment: an ordinary trip. Leave by the trailhead: ordinary extraction.
//   The commitment (at the stones): two presses of 5 - a warning, then the step past it.
//   The return: the base's landmarks have changed (the lantern is out, the tent has moved), calls
//   come from where nothing is (mimicry), and something tall is seen between the trees. The paper
//   map stays truthful. At the last extraction approach the authored encounter interrupts the
//   departure and the screen cuts to black: the canonical disappearance, not an ordinary death.
//   An ordinary death before that encounter is still an ordinary, retryable death.

export const G09 = {
  half: 46,
  start: { x: 0, z: 38 },
  exit: { x: 0, z: 42 },               // the trailhead: the last extraction point
  approach: 14,                        // metres from the exit: the last extraction approach
  river: { z0: 6, z1: 14 },            // the river band (deep), with a ford
  ford: { x0: -4, x1: 4 },
  base: { x: -16, z: -2 }, cache: { x: -13, z: -2 }, lantern: { x: -18, z: 1 },
  site: { x: 0, z: -34 }, siteR: 7,
  cache0: { food: 3, batteries: 2, fuel: 1 },
  ancient: { x: 0, z: -40 },
};

export function buildGymG09(scene) {
  const colliders = [];
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const box = (x, z, w, d, h, color, { collide = true, name, y0 = 0 } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true;
    if (name) m.name = name; scene.add(m); if (collide) colliders.push(new THREE.Box3().setFromObject(m)); return m;
  };
  const H = G09.half, R = G09.river, F = G09.ford;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x2e3a2c)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'gym-floor'; scene.add(ground);
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 3, 0x2a2a2a);
  // The river: deep water across the map, a pale shallow ford in the middle.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, R.z1 - R.z0), mat(0x1a3040, { roughness: 0.15, metalness: 0.3 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.03, (R.z0 + R.z1) / 2); water.name = 'g09-river'; scene.add(water);
  const ford = new THREE.Mesh(new THREE.PlaneGeometry(F.x1 - F.x0, R.z1 - R.z0), mat(0x4a6a6a, { roughness: 0.3 }));
  ford.rotation.x = -Math.PI / 2; ford.position.set((F.x0 + F.x1) / 2, 0.04, (R.z0 + R.z1) / 2); ford.name = 'g09-ford'; scene.add(ford);
  // Dark conifers (proxy art), off the trail.
  let seed = 909; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = (rnd() * 2 - 1) * (H - 2), z = (rnd() * 2 - 1) * (H - 2);
    if (Math.abs(x) < 6 || (z > R.z0 - 1 && z < R.z1 + 1) || Math.hypot(x - G09.base.x, z - G09.base.z) < 8 || Math.hypot(x - G09.site.x, z - G09.site.z) < 12) continue;
    const t = box(x, z, 0.5, 0.5, 8, 0x241e18, { name: 'g09-tree' });
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6, 6), mat(0x16241a)); c.position.set(x, 7, z); scene.add(c);
  }
  // The base: a tent, the cache and the lantern.
  box(G09.base.x, G09.base.z, 3, 2.4, 1.4, 0x6a5a3a, { name: 'g09-base-tent' });
  box(G09.cache.x, G09.cache.z, 1.2, 0.8, 0.8, 0x4a4a52, { name: 'g09-supply-cache' });
  // The final site: a ring of standing stones round a dark centre stone.
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; box(G09.site.x + Math.cos(a) * G09.siteR, G09.site.z + Math.sin(a) * G09.siteR, 1, 0.8, 3.2 + (k % 3) * 0.6, 0x5a5a56, { name: 'g09-standing-stone' }); }
  box(G09.site.x, G09.site.z, 1.2, 1.2, 1.2, 0x1a1a1a, { collide: false, name: 'g09-centre-stone' });
  box(G09.exit.x, G09.exit.z + 2, 3, 0.4, 2.4, 0xd0c060, { collide: false, name: 'g09-trailhead-sign' });
  const surfaceAt = (x, z, y = 0) => (y > 0.15 || z < R.z0 || z > R.z1 ? 'dry' : x > F.x0 && x < F.x1 ? 'shallow' : 'deep');
  return {
    colliders, bounds: H, gym: 'G09', title: 'G09 Finale rehearsal (proxy)', noBigfoot: true, level: 13,
    playerStart: { x: G09.start.x, z: G09.start.z, yaw: 0 }, exit: { ...G09.exit, name: 'the trailhead' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] }, safeZones: [],
    surfaceAt, speedAt: (x, z, y) => ({ deep: 0.3, shallow: 0.6, dry: 1 })[surfaceAt(x, z, y)],
    landmarks: { start: G09.start, ford: { x: 0, z: (R.z0 + R.z1) / 2 }, base: G09.base, site: G09.site, exit: G09.exit },
    places: [{ id: 'trailhead', name: 'Trailhead', ...G09.exit }, { id: 'ford', name: 'Ford', x: 0, z: 10 }, { id: 'base', name: 'Base', ...G09.base }, { id: 'site', name: 'Stones', ...G09.site }],
    trails: [[G09.exit, { x: 0, z: 10 }, { x: 0, z: -2 }, G09.base], [{ x: 0, z: -2 }, G09.site]],
    environment: { background: 0x0a0e12, fog: { color: 0x10161c, near: 14, far: 60 }, lightLevel: 0.22, airTemp: 2 },
  };
}

/** The finale's states and its authored events. phase: 'approach' | 'warned' | 'committed' | 'ended'. */
export class G09World {
  constructor({ game, map, trace, notify = () => {} }) {
    this.g = game; this.map = map; this.trace = trace; this.notify = notify;
    this.time = 0;
    this.phase = 'approach';
    this.outcome = null;              // 'extracted' | 'died' | 'disappeared'
    this.cache = { ...G09.cache0 };
    this.taken = [];
    this.mimicry = [];                // { t, from, heard: 'your own voice', truth: 'nothing there' }
    this.changed = [];                // landmarks that changed after the commitment
    const mat = (c, e = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...e });
    const L = new THREE.PointLight(0xffb060, 4, 10, 1.6); L.position.set(G09.lantern.x, 1.6, G09.lantern.z); game.scene.add(L);
    this.lantern = L;
    // The Ancient: a very tall, thin, dark proxy that is only ever seen after the commitment.
    const a = new THREE.Group(); a.name = 'gym-proxy-ancient';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 6.5, 6), mat(0x0c0c0e)); body.position.y = 3.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), mat(0x0c0c0e)); head.position.y = 6.8;
    a.add(body, head); a.visible = false; a.position.set(G09.ancient.x, 0, G09.ancient.z); game.scene.add(a);
    this.proxy = { mesh: a, get x() { return a.position.x; }, get z() { return a.position.z; }, state: 'unseen' };
    this.black = typeof document !== 'undefined' ? Object.assign(document.createElement('div'), { id: 'g09-black' }) : null;
    if (this.black) { Object.assign(this.black.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', transition: 'opacity 2.5s', pointerEvents: 'none', zIndex: '60' }); document.body.append(this.black); }
    this.mimicClock = 20;
  }

  log(type, data = {}) { this.trace('finale', type, data); }
  near(p, r) { const q = this.g.player.position; return Math.hypot(q.x - p.x, q.z - p.z) <= r; }

  /** Take one of something from the base cache (finite: it never restocks). */
  take(item) {
    if (!this.near(G09.cache, 3)) return { ok: false, why: 'get to the cache' };
    if ((this.cache[item] ?? 0) <= 0) { this.log('cache-empty', { item }); return { ok: false, why: `no ${item} left` }; }
    this.cache[item]--; this.taken.push(item); this.log('cache-take', { item, left: this.cache[item] });
    return { ok: true, left: this.cache[item] };
  }

  /** 5 at the stones: first press warns, the second commits. Elsewhere: nothing. */
  commitStep() {
    if (this.phase === 'ended' || this.phase === 'committed') return { ok: false, why: this.phase };
    if (!this.near(G09.site, G09.siteR + 1)) return { ok: false, why: 'only at the stones' };
    if (this.phase === 'approach') {
      this.phase = 'warned'; this.log('warned', {});
      this.notify('If you go further, there may be no coming back. Press 5 again to go on, or walk away.');
      return { ok: true, phase: this.phase };
    }
    this.phase = 'committed'; this.committedAt = this.time; this.log('committed', {});
    this.notify('You step into the circle.');
    this.changeLandmarks();
    return { ok: true, phase: this.phase };
  }

  /** After the commitment the world changes for real: what you rely on is not where it was. */
  changeLandmarks() {
    this.lantern.intensity = 0;
    this.changed.push('the base lantern is out');
    const tent = this.g.scene.getObjectByName('g09-base-tent');
    if (tent) { tent.position.x += 6; tent.rotation.y = 0.8; this.changed.push('the tent has moved'); }
    this.log('landmarks-changed', { what: [...this.changed] });
  }

  /** Leaving by the trailhead: ordinary extraction before the commitment; the authored end after it. */
  update(dt) {
    this.time += dt;
    if (this.phase === 'ended') return;
    const P = this.g.player.position;
    if (this.g.survival?.health?.value <= 0) { this.end('died'); return; }      // ordinary death: retryable
    if (this.phase !== 'committed') {
      if (this.near(G09.exit, 2.5) && this.leaving) this.end('extracted');
      return;
    }
    // Mimicry: calls from where nothing is (your own voice, the guide's whistle), every so often.
    if ((this.mimicClock -= dt) <= 0) {
      this.mimicClock = 25;
      const a = this.time * 1.7, from = { x: +(P.x + Math.cos(a) * 18).toFixed(1), z: +(P.z + Math.sin(a) * 18).toFixed(1) };
      const heard = ['your own voice calling your name', 'a whistle, like the guide\'s', 'footsteps keeping pace'][this.mimicry.length % 3];
      this.mimicry.push({ t: +this.time.toFixed(1), from, heard, truth: 'nothing there' });
      this.log('mimicry', { from, heard });
      this.notify(`You hear ${heard}.`);
    }
    // Glimpses: it stands between the trees, further back each time you look.
    const sinceCommit = this.time - this.committedAt;
    if (!this.proxy.mesh.visible && sinceCommit > 15) { this.proxy.mesh.visible = true; this.proxy.state = 'watching'; this.proxy.mesh.position.set(P.x - 22, 0, P.z - 10); this.log('glimpse', {}); }
    // The last extraction approach: the authored encounter, then black.
    if (this.near(G09.exit, G09.approach)) {
      this.proxy.mesh.visible = true; this.proxy.state = 'encounter';
      this.proxy.mesh.position.set(G09.exit.x, 0, G09.exit.z - 3);
      this.log('encounter', {});
      this.end('disappeared');
    }
  }

  end(outcome) {
    this.phase = 'ended'; this.outcome = outcome;
    this.log('ended', { outcome });
    if (outcome === 'disappeared' && this.black) this.black.style.opacity = '1';
    if (outcome === 'extracted') this.notify('You drive out. The case stays open.');
    if (outcome === 'died') this.notify('You died out here. (An ordinary death: you can try again.)');
  }
}

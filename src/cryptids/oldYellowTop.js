import * as THREE from 'three';
import { groundAt } from '../maps/ground.js';

// OLD YELLOW TOP (L04 Cobalt; GDD §5.4 row 04: "roams remote paths, rests in cover; detects activity
// and devices; avoids repeatedly disturbed routes, explores unattended camp; not an active hunter").
// Greybox proxy (#133): a big, stooped, pale-crowned shape. Never attacks.
//   Routes     it walks one of the map's remote paths, then rests in cover at its end. Each time it
//              detects you on a route (sees or hears you), or a device set beside it (trail camera,
//              lure), that route's disturbance goes up. It picks the least disturbed route, and won't
//              use one disturbed twice or more.
//   Stalking   with two or more cameras set out, once it notices you near one it follows you at a
//              distance (25-35 m) as you move between camera sites - and walks past the cameras.
//   Camps      a tent left unattended (you 40 m+ away) gets explored: it walks to it, lingers, leaves.
//   Evidence   footprints as it walks, hair now and then, and remote camera events when it crosses a
//              trail camera's view.

export const OYT = { speed: 1.5, stalkSpeed: 1.9, sight: 30, hear: 1, stalkNear: 25, stalkFar: 35, campAway: 40, linger: 10, rest: 20, stride: 2.4, hairEvery: 14 };

export class OldYellowTop {
  constructor({ scene, routes, rests = [], colliders = [], clues = null, x = 0, z = 0 }) {
    this.name = 'Old Yellow Top';
    this.routes = routes.map((r, i) => ({ id: r.id ?? `route${i}`, name: r.name ?? `route ${i + 1}`, pts: r.pts, disturbance: 0 }));
    this.rests = rests; this.colliders = colliders; this.clues = clues;
    this.state = 'roam'; this.route = null; this.i = 0; this.dir = 1; this.timer = 0;
    this.log = []; this.prints = []; this.hair = []; this.walked = 0; this.sinceHair = 0;
    this.noticedOn = new Set();
    const g = new THREE.Group(); g.name = 'old-yellow-top-proxy';
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.4, 4, 8), mat(0x3a3026)); body.position.y = 1.3; body.rotation.x = 0.25;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mat(0xc8b060)); crown.position.set(0, 2.3, -0.15); crown.scale.y = 0.8;
    g.add(body, crown);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), mat(0x3a3026)); arm.position.set(s * 0.6, 1.2, -0.1); g.add(arm); }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.position.set(x, groundAt(x, z), z);
    scene.add(g);
    this.mesh = g;
    this.pickRoute();
  }

  get position() { return this.mesh.position; }
  note(what, extra = {}) { this.log.push({ t: +(this.t ?? 0).toFixed(1), what, ...extra }); }

  /** The least disturbed usable route (disturbed twice or more: avoided). */
  pickRoute() {
    const usable = this.routes.filter((r) => r.disturbance < 2).sort((a, b) => a.disturbance - b.disturbance);
    const r = usable[0] ?? null;
    if (!r) { this.route = null; this.state = 'rest'; this.timer = 0; this.note('every route is disturbed: it stays in cover'); return; }
    if (r !== this.route) this.note('takes a route', { route: r.name, disturbance: r.disturbance, avoided: this.routes.filter((x) => x.disturbance >= 2).map((x) => x.name) });
    this.route = r; this.i = 0; this.dir = 1; this.state = 'roam';
  }

  sees(p) {
    const o = this.position, d = Math.hypot(p.x - o.x, p.z - o.z);
    if (d > OYT.sight) return false;
    const from = new THREE.Vector3(o.x, o.y + 2, o.z), to = new THREE.Vector3(p.x, (p.y ?? 0) + 1.2, p.z), dir = to.clone().sub(from), len = dir.length();
    const ray = new THREE.Ray(from, dir.normalize()), hit = new THREE.Vector3();
    for (const b of this.colliders) if (!b.containsPoint(from) && ray.intersectBox(b, hit) && hit.distanceTo(from) < len - 0.3) return false;
    return true;
  }
  hears(player) { return (player.noise ?? 0) > 0 && Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z) < (player.noiseRadius ?? 0) * OYT.hear; }

  walkTo(t, speed, dt) {
    const p = this.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.4) return true;
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step; p.z += (dz / d) * step; p.y = groundAt(p.x, p.z);
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.walked += step; this.sinceHair += step;
    if (this.walked >= OYT.stride) { this.walked = 0; this.leavePrint(); }
    if (this.sinceHair >= OYT.hairEvery) { this.sinceHair = 0; this.leaveHair(); }
    return false;
  }
  leavePrint() {
    const p = this.position, side = (this.prints.length % 2 ? 1 : -1) * 0.25, h = this.mesh.rotation.y;
    const x = p.x + Math.cos(h) * side, z = p.z - Math.sin(h) * side;
    this.prints.push({ x: +x.toFixed(2), z: +z.toFixed(2) });
    this.clues?.spawn('footprint', { cryptidId: 'oldyellowtop', position: { x, y: 0, z }, rotationY: h, data: { length: 0.46, width: 0.2, toes: 5 } });
  }
  leaveHair() {
    const p = this.position;
    this.hair.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
    this.clues?.spawn('hair', { cryptidId: 'oldyellowtop', position: { x: p.x + 0.4, y: 1.2, z: p.z }, rotationY: 0, data: { color: 0xc8b060 } });
  }

  /** Detected activity or a device beside the route it's on: that route is disturbed. */
  disturb(why) {
    if (!this.route) return;
    const key = `${this.route.id}:${why}:${Math.floor((this.t ?? 0) / 30)}`;
    if (this.noticedOn.has(key)) return;
    this.noticedOn.add(key);
    this.route.disturbance++;
    this.note('route disturbed', { route: this.route.name, why, disturbance: this.route.disturbance });
  }

  /** ctx: { player, cams: [{x, z}], camp: {x, z} | null } */
  update(dt, { player, cams = [], camp = null }) {
    this.t = (this.t ?? 0) + dt;
    const P = player.position, me = this.position;
    const dYou = Math.hypot(P.x - me.x, P.z - me.z);
    const noticed = this.sees(P) || this.hears(player);
    // Devices beside its route (it detects devices).
    if (this.route && this.state === 'roam') for (const c of cams) if (this.route.pts.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 6) && Math.hypot(c.x - me.x, c.z - me.z) < 15) this.disturb('a device by the path');
    // Stalking between camera sites.
    const nearCam = cams.some((c) => Math.hypot(c.x - P.x, c.z - P.z) < 12);
    if (this.state !== 'stalk' && cams.length >= 2 && noticed && nearCam) { this.state = 'stalk'; this.timer = 0; this.note('starts to follow you between the camera sites'); }
    if (this.state === 'stalk') {
      this.timer += dt;
      if (dYou > OYT.stalkFar) this.walkTo(P, OYT.stalkSpeed, dt);
      else if (dYou < OYT.stalkNear) { const away = { x: me.x + (me.x - P.x), z: me.z + (me.z - P.z) }; this.walkTo(away, OYT.speed, dt); }
      if (this.timer > 120 && !nearCam) { this.state = 'roam'; this.note('loses interest'); this.pickRoute(); }
      return;
    }
    // Exploring an unattended camp.
    if (camp && this.state !== 'camp' && Math.hypot(camp.x - P.x, camp.z - P.z) > OYT.campAway && !this.campDone) { this.state = 'camp'; this.timer = 0; this.note('goes to explore your unattended camp'); }
    if (this.state === 'camp') {
      if (Math.hypot(camp.x - P.x, camp.z - P.z) < OYT.campAway * 0.6) { this.state = 'roam'; this.note('you came back: it slips away'); this.pickRoute(); return; }
      if (this.walkTo({ x: camp.x + 1.5, z: camp.z + 1.5 }, OYT.speed, dt)) {
        this.timer += dt;
        if (this.timer === dt) { this.note('explores the camp (touches nothing)'); this.leaveHair(); }
        if (this.timer > OYT.linger) { this.campDone = true; this.note('leaves the camp'); this.pickRoute(); }
      }
      return;
    }
    // Roaming its route, resting in cover at the end.
    if (noticed && this.route) this.disturb('you, on its path');
    if (this.route?.disturbance >= 2 && this.state === 'roam') this.pickRoute();
    if (this.state === 'rest') { if ((this.timer += dt) > OYT.rest) this.pickRoute(); return; }
    if (!this.route) return;
    const [x, z] = this.route.pts[this.i];
    if (this.walkTo({ x, z }, OYT.speed, dt)) {
      this.i += this.dir;
      if (this.i >= this.route.pts.length || this.i < 0) { this.dir = -this.dir; this.i += 2 * this.dir; this.state = 'rest'; this.timer = 0; }
    }
  }
}

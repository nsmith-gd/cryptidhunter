import * as THREE from 'three';
import { CryptidAI } from '../cryptids/cryptidAI.js';
import { makeProfile } from '../cryptids/profiles.js';
import { registerBrain, registerModel } from '../cryptids/species.js';
import { NavGrid } from '../nav/navGrid.js';
import { sel, seq, when, act, Brain, OK, RUN, FAIL } from '../cryptids/brains/bt.js';
import { furTexture } from '../art/pixelTex.js';
import { cellToWorld } from './tunnelLayout.js';

// The Cabbagetown Tunnel Monster (task #123; GDD 1.5 L01, 5.1, 5.4, 12.2), on the shared cryptid
// framework: CryptidAI + Perception (it really sees your light and hears your steps) + a behaviour
// tree + a NavGrid over the tunnels. Lore: it shelters in side chambers, avoids light and nearby
// noise, is briefly curious. Observe, vocalize, retreat: it never attacks and never chases.
//
//   den       resting in a side chamber, out of sight. After a while it slips out again.
//   creep     moving through the tunnels to a VANTAGE point somewhere ahead of you: a junction
//             mouth or chamber edge with a sightline down a tunnel and some light on it (the grate's
//             streetlight, an old work lamp), where a good photo is possible.
//   linger    at the vantage: a hunched shape at the edge of the light, eyes catching your torch,
//             head turned to you. The photo opportunity. The more careful you are (still or slow,
//             crouched or quiet, light off or kept off it) the longer it stays, and if you're very
//             still it edges a step closer (the stalking rules of #115, scaled down: it is curious,
//             not a hunter). Time up, it slips quietly back to a den: no harm done.
//   startled  your torch held on it past a brief flinch, a loud noise nearby, rushing it, or coming
//             within a few metres: a chitter and it scuttles to the nearest den. Each scare makes it
//             wait longer before coming out; after a few it stays hidden for the rest of the attempt.
//             The level never ends because of it: escaping is still the goal.
// The flinch is deliberate: your beam on it gives you about a second before it bolts. A careful
// player approaches in the dark and photographs it in the lamp or streetlight (or uses the flinch).

export const TUNNEL_MONSTER = {
  // Dens: side chambers and dead ends, out of sight of the main tunnels (cells).
  dens: [{ x: 44, y: 15 }, { x: 50, y: 5 }, { x: 20, y: 28 }, { x: 62, y: 20 }, { x: 34, y: 32 }, { x: 8, y: 5 }],
  // Vantage points (cells): where it shows itself, the cell it watches down, and whether a work lamp
  // was added there (the grate already has its streetlight; the alcove passage its steam glow).
  vantages: [
    { key: 'grate', at: { x: 59, y: 21 }, light: 'streetlight', den: { x: 62, y: 20 } },
    { key: 'east-gallery', at: { x: 47, y: 10 }, light: 'work lamp', den: { x: 50, y: 5 } },
    { key: 'pump-passage', at: { x: 18, y: 24 }, light: 'work lamp', den: { x: 20, y: 28 } },
    { key: 'lower-junction', at: { x: 40, y: 23 }, light: 'dark', den: { x: 44, y: 15 } },
    { key: 'alcove-passage', at: { x: 31, y: 24 }, light: 'steam glow', den: { x: 34, y: 32 } },
  ],
  rest: [6, 12],          // s in a den before coming out (first time)
  restPerScare: 14,       // extra rest per scare so far
  maxScares: 3,           // scared off this many times: it stays hidden for the rest of the attempt
  showRange: [10, 56],    // m: picks a vantage this far from you, ahead of you if it can
  linger: 7,              // s at a vantage if you're careless (moving fast, noisy or lighting it)
  carefulRate: 0.15,      // while you're careful its linger clock runs at this rate (~45 s)
  maxLinger: 60,          // s: it never stays longer than this at one vantage
  flinch: 1.1,            // s your beam can rest on it before it bolts (the photo window)
  boltInside: 6,          // m: closer than this and it bolts whatever you do
  loud: 0.45,             // hearing level that startles it
  rush: 2.4,              // m/s toward it that startles it
  edgeCloser: 0.35,       // m/s it edges toward you while you're perfectly still and dark
  closest: 9,             // m: it never edges closer than this
};

export const TUNNEL_PROFILE = makeProfile({
  id: 'tunnelMonster',
  name: 'Tunnel creature',
  brain: 'tunnelMonster',
  model: 'tunnelMonster',
  height: 1.25, radius: 0.5,
  color: 0x3a312b,
  roamRadius: 10, roamSpeed: 1.6, roamPause: [2, 4],
  fleeSafeDistance: 30, fleeSpeed: 5.5, fleeStep: 12, acceleration: 8, turnRate: 6,
  catchHits: 99, threatening: false,
  senses: Object.freeze({ hearing: 1.6, sightRange: 30, viewAngle: 80 }),
  behavior: { onDetect: 'flee', observeAt: 0.2, observeTime: 3, lookAround: 2 },
});

/** The hunched, furry body (the L01 proxy's look, kept): userData.body for the state tint. */
export function buildTunnelMonsterModel() {
  const g = new THREE.Group(); g.name = 'cryptid-tunnelMonster';
  const fur = new THREE.MeshStandardMaterial({ map: furTexture(1), color: 0x3a312b, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), fur);
  body.scale.set(0.9, 1.15, 1.2); body.position.y = 0.72; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 5), fur);
  head.position.set(0, 1.12, -0.42); head.name = 'head';
  const eye = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  for (const s of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), eye); e.position.set(s * 1.2, 0.05, -0.24); head.add(e); }
  g.add(body, head);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.8, 5), fur);
    arm.position.set(s * 0.42, 0.42, -0.3); arm.rotation.x = 0.4; g.add(arm);
  }
  g.userData.body = body;
  g.userData.head = head;
  // A little life: head tilt while it watches, a scuttle bob when it runs.
  g.userData.animate = (dt, speed, state) => {
    g.userData.t = (g.userData.t ?? 0) + dt;
    head.rotation.z = state === 'linger' ? Math.sin(g.userData.t * 2.2) * 0.25 : 0;
    body.position.y = 0.72 + (speed > 2 ? Math.abs(Math.sin(g.userData.t * 14)) * 0.06 : 0);
    body.scale.y = state === 'flinch' ? 1.3 : 1.15;      // rears up when your beam hits it
  };
  return g;
}

/** Its behaviour tree. c: the CryptidAI; c.tunnel: { dens, vantages } in world coordinates. */
export function tunnelMonsterBrain(c) {
  const T = TUNNEL_MONSTER, pc = () => c.perception, P = () => c.p;
  const log = (type, data = {}) => { (c.events ??= []).push({ t: +c.clock.toFixed(2), type, ...data }); c.emit(type, data); };
  c.scares ??= 0;
  const goTo = (pt, speed, state, why) => { c.setState(state, why); c.agent.speed = speed; c.goal = pt; c.agent.setDestination(pt.x, pt.z); };
  const nearestDen = (from) => [...c.tunnel.dens].sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
  const startle = (why) => {
    c.scares++;
    const den = c.vantage?.den ?? nearestDen(c.agent);
    log('startled', { why, scares: c.scares, distance: +c.playerDistance.toFixed(1) });
    goTo(den, c.profile.fleeSpeed, 'startled', why);
    c.restLeft = T.rest[1] + T.restPerScare * c.scares;
    return RUN;
  };
  const careful = () => {
    const pl = pc().player, v = pl.velocity, moving = Math.hypot(v.x, v.z);
    const quiet = (pc().hearLevel ?? 0) < 0.15;
    return moving < 1.2 && quiet && (pc().beamLevel ?? 0) <= 0;
  };
  const pickVantage = () => {
    const p = P(), pl = pc().player, v = pl.velocity;
    const heading = Math.hypot(v.x, v.z) > 0.3 ? { x: v.x, z: v.z } : { x: -Math.sin(pl.yaw ?? 0), z: -Math.cos(pl.yaw ?? 0) };
    const score = (vp) => {
      const dx = vp.x - p.x, dz = vp.z - p.z, d = Math.hypot(dx, dz);
      if (d < T.showRange[0] || d > T.showRange[1] || vp.key === c.lastVantage) return -Infinity;
      const ahead = (dx * heading.x + dz * heading.z) / (d * (Math.hypot(heading.x, heading.z) || 1));
      return ahead * 10 - d * 0.1 + (vp.light !== 'dark' ? 3 : 0);
    };
    const pick = [...c.tunnel.vantages].sort((a, b) => score(b) - score(a)).find((vp) => score(vp) > -Infinity);
    if (pick) return pick;
    // Nowhere new in range: it comes back to the last place it showed itself, if that's still in range.
    const last = c.tunnel.vantages.find((vp) => vp.key === c.lastVantage);
    const d = last ? Math.hypot(last.x - p.x, last.z - p.z) : Infinity;
    return d >= T.showRange[0] && d <= T.showRange[1] ? last : null;
  };

  const root = sel('Tunnel creature',
    // Gone for good after too many scares: it stays deep in its den.
    seq('Hiding for good', when('scared off too often', () => c.scares >= T.maxScares && c.state !== 'startled'),
      act('stay hidden', () => { if (c.state !== 'hidden') { c.setState('hidden', 'scared off for good'); c.mesh.visible = false; log('gone', { scares: c.scares }); } return RUN; })),
    // Running for a den: see it through, then rest out of sight.
    seq('Going home', when('startled or withdrawing', () => c.state === 'startled' || c.state === 'withdraw'),
      act('scuttle to its den', () => {
        if (c.agent.hasPath && c.agent.remainingDistance > 0.6) return RUN;
        c.setState('den', 'safe in its den'); c.mesh.visible = false; return OK;
      })),
    // Out in the open (creeping or lingering): anything careless startles it.
    seq('Spooked', when('out and you are careless', () => {
      if (c.state !== 'creep' && c.state !== 'linger' && c.state !== 'flinch') return false;
      const pl = pc().player, v = pl.velocity, d = c.playerDistance;
      const toX = c.agent.x - P().x, toZ = c.agent.z - P().z;
      const rushing = (v.x * toX + v.z * toZ) / (d || 1) > T.rush;
      c.spookWhy = d < T.boltInside ? 'you came too close' : (pc().hearLevel ?? 0) > T.loud ? 'your noise' : rushing ? 'you rushed it'
        : c.state === 'flinch' && c.flinchLeft <= 0 ? 'your light' : null;
      return !!c.spookWhy;
    }), act('chitter and bolt', () => startle(c.spookWhy))),
    // Your beam lands on it: it flinches (rears, eyes flare) for a moment first.
    seq('Flinch', when('beam on it', () => (c.state === 'linger' || c.state === 'creep') && (pc().beamLevel ?? 0) > 0),
      act('flinch from the light', () => { c.setState('flinch', 'your light'); c.flinchLeft = T.flinch; c.agent.stop?.(); log('flinch', { distance: +c.playerDistance.toFixed(1) }); return RUN; })),
    seq('Flinching', when('flinching', () => c.state === 'flinch'),
      act('rear in the light', () => {
        c.flinchLeft -= c.dt;
        c.faceToward(P().x, P().z, c.dt, 4);
        if ((pc().beamLevel ?? 0) <= 0) { c.setState('linger', 'light moved off it'); }
        return RUN;
      })),
    // At its vantage: watching you, the photo opportunity.
    seq('Lingering', when('lingering', () => c.state === 'linger'),
      act('watch you from the edge of the light', () => {
        // Careful (slow or still, quiet, light off it): its curiosity holds and the clock barely runs.
        c.lingerLeft -= c.dt * (careful() ? T.carefulRate : 1);
        if ((c.lingerTime ?? 0) > T.maxLinger) c.lingerLeft = 0;
        c.faceToward(P().x, P().z, c.dt, 3);
        // Perfectly still and dark: it edges a step closer (curious), never nearer than `closest`.
        const still = Math.hypot(pc().player.velocity.x, pc().player.velocity.z) < 0.2 && (pc().beamLevel ?? 0) <= 0;
        if (still && c.playerDistance > T.closest && !c.agent.hasPath) {
          const k = T.edgeCloser * c.dt / c.playerDistance;
          const nx = c.agent.x + (P().x - c.agent.x) * k, nz = c.agent.z + (P().z - c.agent.z) * k;
          const s = c.agent.grid.sample(nx, nz, 0.5); if (s) { c.agent.x = s.x; c.agent.z = s.z; }
        }
        c.lingerTime = (c.lingerTime ?? 0) + c.dt;
        if (c.lingerLeft <= 0) { log('slipped-away', { lingered: +c.lingerTime.toFixed(1) }); goTo(c.vantage.den, c.profile.roamSpeed, 'withdraw', 'had its look'); c.restLeft = T.rest[0] + T.restPerScare * c.scares; }
        return RUN;
      })),
    // Moving out to a vantage.
    seq('Creeping', when('creeping', () => c.state === 'creep'),
      act('creep to the vantage', () => {
        if (c.agent.hasPath && c.agent.remainingDistance > 0.5) return RUN;
        c.setState('linger', `watching from ${c.vantage.key}`);
        c.lingerLeft = T.linger; c.lingerTime = 0;
        log('showing', { vantage: c.vantage.key, light: c.vantage.light, distance: +c.playerDistance.toFixed(1) });
        return RUN;
      })),
    // In a den: rest, then come out to a vantage ahead of you.
    act('rest, then come out', () => {
      if (c.state !== 'den') { c.setState('den', 'resting'); c.mesh.visible = false; c.restLeft ??= T.rest[0] + c.rand() * (T.rest[1] - T.rest[0]); }
      if ((c.restLeft -= c.dt) > 0) return RUN;
      const vp = pickVantage();
      if (!vp) { c.restLeft = 3; return RUN; }
      c.vantage = vp; c.lastVantage = vp.key;
      c.mesh.visible = true;
      // It comes out from the vantage's own den side, so it emerges from the dark.
      const from = c.agent.grid.sample(vp.den.x, vp.den.z, 2) ?? vp.den;
      c.agent.x = from.x; c.agent.z = from.z; c.agent.path = null;
      goTo(vp, c.profile.roamSpeed * 0.8, 'creep', `heading for ${vp.key}`);
      log('emerging', { vantage: vp.key });
      return RUN;
    }),
  );
  return new Brain(root, { get level() { return 1; } });
}

registerBrain('tunnelMonster', tunnelMonsterBrain);
registerModel('tunnelMonster', buildTunnelMonsterModel);

/**
 * The creature in the L01 tunnels, wrapping CryptidAI with the tunnels' own nav grid and points.
 * senses: { player, flashlight, camera, colliders, lightLevel }. onEvent(type, data).
 * Keeps the proxy's API for main.js: update(dt, player), closest, state, mesh.
 */
export class TunnelMonster {
  constructor({ scene, colliders, senses, onEvent = () => {}, rand }) {
    this.grid = new NavGrid(colliders, { halfSize: 130, cellSize: 0.5, agentRadius: 0.45 });
    this.dens = TUNNEL_MONSTER.dens.map(cellToWorld);
    this.vantages = TUNNEL_MONSTER.vantages.map((v) => ({ ...v, ...cellToWorld(v.at), den: cellToWorld(v.den) }));
    this.lamps = [];
    for (const v of this.vantages.filter((x) => x.light === 'work lamp')) this.lamps.push(addWorkLamp(scene, v));
    const d0 = this.dens[0];
    this.ai = new CryptidAI({ scene, grid: this.grid, profile: TUNNEL_PROFILE, x: d0.x, z: d0.z, getPlayerPosition: () => senses.player.position,
      senses, rand, onEvent: (type, data) => onEvent(type, data) });
    this.ai.tunnel = { dens: this.dens, vantages: this.vantages };
    this.ai.mesh.visible = false;
    this.closest = Infinity;
  }

  get mesh() { return this.ai.mesh; }
  get state() { return this.ai.state; }
  get events() { return this.ai.events ?? []; }

  update(dt) {
    this.ai.update(dt);
    if (this.ai.mesh.visible) this.closest = Math.min(this.closest, this.ai.playerDistance);
  }

  /** For the camera: the creature as a photo subject while it's out. */
  subjects() {
    const m = this.ai.mesh;
    if (!m.visible) return [];
    return [{ id: 'tunnel-monster', name: 'the tunnel creature', object3d: m, center: m.position.clone().setY(0.8), radius: 0.6,
      base: m.position.clone(), height: TUNNEL_PROFILE.height }];
  }
}

/** A caged work lamp still burning over a vantage: dim, warm, a small pool of light. */
function addWorkLamp(scene, v) {
  const g = new THREE.Group(); g.name = `work-lamp:${v.key}`;
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.8, wireframe: true }));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  const light = new THREE.PointLight(0xffb060, 3.2, 9, 1.4);
  g.add(cage, bulb, light);
  g.position.set(v.x, 2.7, v.z);
  scene.add(g);
  return g;
}

import * as THREE from 'three';

// Gym G05: water, weather and power (GDD 15.2 G05; task #108's harness; task #138). Greybox.
// ?map=g05 (calm) or ?map=g05&storm. A small lake with a shore station, a dock and a rental boat,
// controlled deep water, a cold-water recovery hut, a generator / charging station, a sonar buoy out
// on the deep water and a dry land exit. The systems below are gym stand-ins that each own their
// state (the GDD's S12 energy & fuel, S13 aquatic traversal), so the pass criteria can be checked:
//   Boat        board at the dock (E); W/S throttle, A/D steer. The engine burns fuel in proportion to
//               throttle (more in the storm, which also pushes the boat downwind). No fuel: the engine
//               dies and you can only paddle slowly. Its vibration carries through the water.
//   PowerBank   one battery bank feeding the sonar and the GPS. Each use draws from it once. Flat:
//               exactly those go off; your torch (own battery) and paper map still work. The shore
//               generator recharges it while it runs, burning its own fuel.
//   Breath      in deep water (off the boat) you're treading water: breath drains; out of it, it
//               refills. At zero, drowning damage goes through health (S08), the only damage path.
//               Cold and wetness are thermoregulation's (it already knows deep water).
//   SonarBuoy   logs readings while powered from the boat's bank on contact; the data lives on the
//               buoy until you copy it to the boat log (R near it). Uncopied data is lost if you leave.
//   Proxy       something under the water that investigates engine vibration, and bumps the boat
//               (it lurches) if it gets right under it. Engine off: it loses interest.

export const G05 = {
  half: 40,
  lake: { x: 0, z: -6, rx: 26, rz: 20 },       // ellipse; the outer 4 m are shallow
  shallowBand: 4,
  dock: { x: 0, z: 15 }, mooring: { x: 0, z: 11 }, station: { x: 6, z: 22 }, generator: { x: 10, z: 21 }, hut: { x: -14, z: 21 },
  buoy: { x: -8, z: -14 }, exit: { x: 34, z: 30 }, start: { x: -2, z: 28 },
  boat: { speed: 4.2, paddle: 0.8, turn: 1.1, fuelPerSec: 0.012, stormFuel: 1.5, stormDrift: 0.9, radius: 1.6 },
  power: { capacity: 100, sonarPing: 6, gpsPerSec: 0.4, chargePerSec: 4, genFuelPerSec: 0.01 },
  breath: { max: 30, drain: 1, refill: 6, drownDamage: 4 },
  proxy: { hears: 40, speed: 2.2, bumpAt: 2.5, bumpCooldown: 6 },
};

export const insideLake = (x, z, shrink = 0) => {
  const L = G05.lake;
  return ((x - L.x) / (L.rx - shrink)) ** 2 + ((z - L.z) / (L.rz - shrink)) ** 2 < 1;
};

export function buildGymG05(scene) {
  const colliders = [];
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const box = (x, z, w, d, h, color, { collide = true, y0 = 0, name } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; if (name) m.name = name;
    scene.add(m);
    if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const H = G05.half, L = G05.lake;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), mat(0x4a5040));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'gym-floor';
  scene.add(ground);
  for (const [x, z, w, d] of [[0, -H - 0.5, H * 2, 1], [0, H + 0.5, H * 2, 1], [-H - 0.5, 0, 1, H * 2], [H + 0.5, 0, 1, H * 2]]) box(x, z, w, d, 3, 0x3a3a3a);
  // The lake: a shallow rim and a deep middle (two flat ellipses).
  const ell = (rx, rz, color, y, name, extra) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat(color, extra));
    m.scale.set(rx, rz, 1); m.rotation.x = -Math.PI / 2; m.position.set(L.x, y, L.z); m.name = name;
    scene.add(m); return m;
  };
  ell(L.rx, L.rz, 0x3a6a78, 0.02, 'g05-shallows', { roughness: 0.15, metalness: 0.3 });
  ell(L.rx - G05.shallowBand, L.rz - G05.shallowBand, 0x1a3a4a, 0.03, 'g05-deep-water', { roughness: 0.1, metalness: 0.4 });
  // Shore station: a shed with the charging bench, the generator beside it, a dock out over the shallows.
  box(G05.station.x, G05.station.z, 5, 4, 2.8, 0x6a6a5a, { name: 'g05-station' });
  box(G05.generator.x, G05.generator.z, 1.4, 1, 1.1, 0xb08a2a, { name: 'g05-generator' });
  box(G05.dock.x, G05.dock.z - 1, 2.2, 6, 0.3, 0x7a5a3a, { collide: false, name: 'g05-dock' });   // out over the shallows to the mooring
  // Cold-water recovery hut (heated) and the dry exit along the east shore path.
  box(G05.hut.x, G05.hut.z, 3.5, 3, 2.4, 0x7a4a3a, { name: 'g05-recovery-hut' });
  const hutGlow = new THREE.PointLight(0xffa060, 3, 8, 1.4); hutGlow.position.set(G05.hut.x, 1.8, G05.hut.z - 1.7); scene.add(hutGlow);
  for (let i = 0; i <= 10; i++) { const t = i / 10; const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat(0x6a5a44)); p.rotation.x = -Math.PI / 2; p.position.set(G05.start.x + (G05.exit.x - G05.start.x) * t, 0.012, G05.start.z + (G05.exit.z - G05.start.z) * t); p.name = 'g05-shore-path'; scene.add(p); }
  box(G05.exit.x, G05.exit.z + 2, 3, 0.4, 2.4, 0xd0c060, { collide: false, name: 'g05-dry-exit' });
  const lamp = new THREE.PointLight(0xfff0d0, 4, 14, 1.6); lamp.position.set(G05.station.x, 3.2, G05.station.z - 2.4); scene.add(lamp);
  // Sonar buoy (a float with a mast) on the deep water.
  const buoy = new THREE.Group(); buoy.name = 'g05-sonar-buoy';
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.6, 10), mat(0xd04a2a)); fl.position.y = 0.2;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), mat(0xdddddd)); mast.position.y = 1.1;
  buoy.add(fl, mast); buoy.position.set(G05.buoy.x, 0, G05.buoy.z); scene.add(buoy);
  const surfaceAt = (x, z, y = 0) => (y > 0.15 ? 'dry' : insideLake(x, z, G05.shallowBand) ? 'deep' : insideLake(x, z) ? 'shallow' : 'dry');
  return {
    colliders, bounds: H, gym: 'G05', title: 'G05 Water, weather and power', noBigfoot: true, level: 5,
    playerStart: { x: G05.start.x, z: G05.start.z, yaw: Math.PI }, exit: { ...G05.exit, name: 'the dry exit' },
    spawns: {}, spawnZones: { bigfoot: [], clues: [] },
    surfaceAt, speedAt: (x, z, y) => ({ deep: 0.35, shallow: 0.6, dry: 1 })[surfaceAt(x, z, y)],
    safeZones: [{ x: G05.hut.x, z: G05.hut.z, r: 2.6, name: 'recovery hut' }],
    landmarks: { start: G05.start, dock: G05.dock, station: G05.station, generator: G05.generator, hut: G05.hut, buoy: G05.buoy, exit: G05.exit },
    // ?storm: rain (wets you, see weather.js), darker and colder; the boat drifts and burns more fuel (G05World).
    environment: typeof location !== 'undefined' && new URLSearchParams(location.search).has('storm')
      ? { background: 0x10161e, fog: { color: 0x1a222c, near: 15, far: 60 }, lightLevel: 0.22, airTemp: 6, rain: 1 }
      : { background: 0x1a2230, fog: { color: 0x2a3444, near: 25, far: 90 }, lightLevel: 0.35, airTemp: 9 },
    buoyMesh: buoy,
  };
}

/** The gym's systems; the harness steps them and reads their state. trace(system, type, data). */
export class G05World {
  constructor({ game, map, trace, storm = false, notify = () => {} }) {
    this.g = game; this.map = map; this.trace = trace; this.storm = storm; this.notify = notify;
    const B = G05.boat;
    // Boat.
    const hull = new THREE.Group(); hull.name = 'g05-boat';
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.6), new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6 }));
    body.position.y = 0.3; hull.add(body);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    motor.position.set(0, 0.6, 1.9); hull.add(motor);
    game.scene.add(hull);
    this.boat = { mesh: hull, x: G05.mooring.x, z: G05.mooring.z, heading: 0, speed: 0, throttle: 0, fuel: 1, aboard: false, engine: false, lurch: 0 };
    this.placeBoat();
    // Power, generator, breath, buoy, proxy.
    this.power = { charge: G05.power.capacity, gps: true, sonar: true, flat: false };
    this.generator = { fuel: 1, running: false };
    this.breath = { value: G05.breath.max, under: false };
    this.buoy = { readings: [], copied: [], powered: false, lost: false };
    const pm = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 6), new THREE.MeshStandardMaterial({ color: 0x1a2a2a, transparent: true, opacity: 0.55 }));
    pm.scale.set(1.6, 0.5, 1); pm.position.y = -0.35; pm.name = 'g05-proxy'; game.scene.add(pm);
    this.proxy = { mesh: pm, x: 10, z: -16, state: 'idle', lastBump: -99, bumps: 0 };
    this.time = 0; this.speedK = B.speed;
    this.devices = ['sonar', 'gps', 'torch', 'paper map'];
    this.faults = [];      // { t, fault, cause, recovery } each scripted fault, as shown to the player
  }

  /** Every device's state: only the battery-bank ones depend on the bank. */
  deviceStatus() {
    const on = !this.power.flat;
    return { sonar: on, gps: on, torch: (this.g.flashlight.battery ?? 1) > 0, 'paper map': true, engine: this.boat.fuel > 0 };
  }

  fault(fault, cause, recovery) {
    if (this.faults.some((f) => f.fault === fault && this.time - f.t < 5)) return;
    this.faults.push({ t: +this.time.toFixed(1), fault, cause, recovery });
    this.trace('fault', fault, { cause, recovery });
    this.notify(`${cause}. ${recovery}`);
  }

  placeBoat() { const b = this.boat; b.mesh.position.set(b.x, 0, b.z); b.mesh.rotation.y = b.heading; b.mesh.rotation.z = Math.sin(this.time * 9) * 0.2 * b.lurch; }

  board() {
    const p = this.g.player.position, b = this.boat;
    if (Math.hypot(p.x - b.x, p.z - b.z) > 3.5) return false;
    b.aboard = true; this.trace('boat', 'boarded', {}); return true;
  }

  /** Step off the boat: onto the dock if you're at it, otherwise into the water. */
  leave() {
    const b = this.boat, P = this.g.player;
    b.aboard = false; b.engine = false; b.throttle = 0;
    const atDock = Math.hypot(b.x - G05.mooring.x, b.z - G05.mooring.z) < 4;
    const off = atDock ? { x: G05.dock.x, z: G05.dock.z + 1 } : { x: b.x + 2.2, z: b.z };
    P.position.set(off.x, 0, off.z); P.velocity.set(0, 0, 0);
    this.trace('boat', atDock ? 'stepped onto the dock' : 'went over the side', { at: [+off.x.toFixed(1), +off.z.toFixed(1)] });
  }

  setEngine(on) {
    const b = this.boat;
    if (on && b.fuel <= 0) { this.fault('out-of-fuel', 'Out of fuel: the engine won\'t start', 'Paddle back to the dock (slow), or refuel at the station'); return false; }
    b.engine = on; this.trace('boat', on ? 'engine on' : 'engine off', { fuel: +b.fuel.toFixed(3) });
    return true;
  }

  /** One sonar ping: draws from the bank once; logs to the buoy if you're beside it. */
  ping() {
    if (this.power.flat) { this.fault('battery-flat', 'Battery flat: the sonar and GPS are off', 'Charge it at the station generator, or navigate by the paper map'); return null; }
    this.power.charge = Math.max(0, this.power.charge - G05.power.sonarPing);
    const b = this.boat, d = Math.hypot(b.x - G05.buoy.x, b.z - G05.buoy.z);
    const reading = { t: +this.time.toFixed(1), depth: +(6 + Math.sin(b.x * 0.3 + b.z * 0.2) * 2).toFixed(1), at: [+b.x.toFixed(1), +b.z.toFixed(1)], echo: d < 18 && this.proxy.state !== 'idle' ? 'large return' : 'clear' };
    if (d < 6) { this.buoy.readings.push(reading); this.trace('sensor', 'buoy logged', { readings: this.buoy.readings.length }); }
    this.trace('power', 'sonar ping', { charge: +this.power.charge.toFixed(2) });
    return reading;
  }

  /** Copy the buoy's data to the boat log (needs you beside it). The copy is what survives. */
  copyBuoy() {
    const b = this.boat;
    if (Math.hypot(b.x - G05.buoy.x, b.z - G05.buoy.z) > 6) return false;
    this.buoy.copied = this.buoy.readings.map((r) => ({ ...r }));
    this.trace('sensor', 'data copied', { readings: this.buoy.copied.length });
    return true;
  }

  runGenerator(on) {
    if (on && this.generator.fuel <= 0) { this.fault('generator-empty', 'The generator is out of fuel', 'Refuel it from the station cans'); return false; }
    const P = this.g.player.position;
    if (on && Math.hypot(P.x - G05.generator.x, P.z - G05.generator.z) > 3) return false;
    this.generator.running = on; this.trace('power', on ? 'generator on' : 'generator off', {}); return true;
  }

  update(dt) {
    this.time += dt;
    const g = this.g, P = g.player, b = this.boat, B = G05.boat;
    // Boat: throttle and steering from the held keys while aboard.
    if (b.aboard) {
      const k = g.input.keys;
      b.throttle = k.has('KeyW') ? 1 : k.has('KeyS') ? -0.4 : 0;
      if (k.has('KeyA')) b.heading += B.turn * dt;
      if (k.has('KeyD')) b.heading -= B.turn * dt;
      const powered = b.engine && b.fuel > 0;
      const speed = powered ? B.speed * b.throttle : B.paddle * Math.sign(b.throttle);
      if (powered && b.throttle !== 0) {
        const burn = B.fuelPerSec * Math.abs(b.throttle) * (this.storm ? B.stormFuel : 1) * dt;
        b.fuel = Math.max(0, b.fuel - burn);
        if (b.fuel <= 0) { b.engine = false; this.fault('out-of-fuel', 'Out of fuel: the engine coughs and dies', 'Paddle back to the dock (slow), or refuel at the station'); }
      }
      let nx = b.x - Math.sin(b.heading) * speed * dt, nz = b.z - Math.cos(b.heading) * speed * dt;
      if (this.storm) { nx += B.stormDrift * dt; nz += 0.3 * B.stormDrift * dt; }    // wind and waves push you east
      if (insideLake(nx, nz, 1.2)) { b.x = nx; b.z = nz; }                            // the boat stays on the water
      b.speed = speed;
      P.position.set(b.x, 0.35, b.z); P.velocity.set(0, 0, 0);                         // you sit in it
      if (this.power.gps && !this.power.flat) this.power.charge = Math.max(0, this.power.charge - G05.power.gpsPerSec * dt);
    }
    b.lurch = Math.max(0, b.lurch - dt);
    this.placeBoat();
    // Generator charges the bank (it burns its own fuel, not the boat's).
    if (this.generator.running) {
      this.generator.fuel = Math.max(0, this.generator.fuel - G05.power.genFuelPerSec * dt);
      this.power.charge = Math.min(G05.power.capacity, this.power.charge + G05.power.chargePerSec * dt);
      if (this.generator.fuel <= 0) { this.generator.running = false; this.fault('generator-empty', 'The generator sputters out: no fuel', 'Refuel it from the station cans'); }
    }
    const flat = this.power.charge <= 0;
    if (flat && !this.power.flat) this.fault('battery-flat', 'Battery flat: the sonar and GPS are off', 'Charge it at the station generator, or navigate by the paper map');
    if (!flat && this.power.flat) this.trace('power', 'restored', { charge: +this.power.charge.toFixed(1) });
    this.power.flat = flat;
    // Breath (S13): treading deep water off the boat drains it; out of the water it refills.
    const inDeep = !b.aboard && this.map.surfaceAt(P.position.x, P.position.z, P.position.y) === 'deep';
    if (inDeep && !this.breath.under) { this.breath.under = true; this.fault('in-the-water', 'You\'re in deep, cold water: breath and warmth are going', 'Get to the shallows or the dock; the heated hut on the west shore is the recovery point'); }
    if (!inDeep && this.breath.under) { this.breath.under = false; this.trace('water', 'out of deep water', { breath: +this.breath.value.toFixed(1) }); }
    const Bm = G05.breath;
    this.breath.value = inDeep ? Math.max(0, this.breath.value - Bm.drain * dt) : Math.min(Bm.max, this.breath.value + Bm.refill * dt);
    g.survival.health.exposure('Drowning', Bm.drownDamage, dt, inDeep && this.breath.value <= 0);
    // The proxy: engine vibration within range draws it in; right under the boat it bumps it.
    const pr = this.proxy, C = G05.proxy;
    const vib = b.engine && b.fuel > 0 && Math.abs(b.throttle) > 0;
    const d = Math.hypot(b.x - pr.x, b.z - pr.z);
    const want = vib && d < C.hears ? 'investigating' : 'idle';
    if (want !== pr.state) { pr.state = want; this.trace('proxy', want, { distance: +d.toFixed(1) }); }
    if (pr.state === 'investigating') {
      const s = Math.min(d, C.speed * dt);
      if (d > 1e-6) { pr.x += (b.x - pr.x) / d * s; pr.z += (b.z - pr.z) / d * s; }
      if (d < C.bumpAt && this.time - pr.lastBump > C.bumpCooldown) {
        pr.lastBump = this.time; pr.bumps++; b.lurch = 1.2; b.heading += 0.5;
        this.trace('proxy', 'bumped the boat', { bumps: pr.bumps });
        this.notify('Something huge bumps the hull from below. The boat lurches.');
      }
    }
    pr.mesh.position.set(pr.x, -0.35, pr.z);
  }

  /** Leaving: copied buoy data comes with you; anything only on the buoy is lost. */
  extract() {
    const kept = this.buoy.copied.length, lost = this.buoy.readings.length - kept;
    this.trace('sensor', 'extracted', { kept, lost });
    return { kept, lost };
  }
}

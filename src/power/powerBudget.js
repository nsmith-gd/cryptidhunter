// S12 Energy & fuel logistics (GDD 1.2 S12, 2.13, 3.2 E01–E04; task #140). Owns battery packs, the
// devices wired to them, fuel tanks and generators. Nobody else writes charge or fuel: devices ask
// (`setDevice`, `draw`), the boat burns through a tank view, a generator turns fuel into charge.
//
//   Pack       a battery (boat battery, power bank, spare packs): charge 0..capacity.
//   Device     wired to exactly one pack. Continuous draw while on (GPS, lantern, hydrophone) and/or
//              one-shot draws (a sonar ping). A flat pack switches off only the devices wired to it:
//              everything else, and your body, are untouched (GDD 2.13).
//   Swap       rewire a device (or every device on a flat pack) to another pack, e.g. a spare.
//   Tank       fuel in litres, by type (outboard/generator petrol; never stove canisters). `pour`
//              moves fuel between tanks of the same type.
//   Generator  burns its own tank to charge whichever packs are plugged in to it.
// Charge is in game units shown as percent; litres are litres. Every change is traced once, at the
// moment it happens (flat, restored, empty, refuelled), with a cause and a way to recover.

export class PowerBudget {
  constructor({ trace = () => {}, notify = () => {} } = {}) {
    this.trace = trace; this.notify = notify;
    this.packs = new Map(); this.devices = new Map(); this.tanks = new Map(); this.generators = new Map();
    this.time = 0;
  }

  addPack(id, { name, capacity, charge = capacity, spare = false }) {
    this.packs.set(id, { id, name, capacity, charge, spare, flat: charge <= 0, plugged: null });
    return this;
  }
  addDevice(id, { name, pack, drawPerSec = 0, on = false, analogue = false }) {
    this.devices.set(id, { id, name, pack, drawPerSec, wantOn: on, analogue });
    return this;
  }
  addTank(id, { name, litres, capacity, type = 'petrol' }) {
    this.tanks.set(id, { id, name, litres, capacity, type, empty: litres <= 0 });
    return this;
  }
  addGenerator(id, { name, tank, litresPerSec, chargePerSec }) {
    this.generators.set(id, { id, name, tank, litresPerSec, chargePerSec, running: false });
    return this;
  }

  pack(id) { return this.packs.get(id); }
  device(id) { return this.devices.get(id); }
  tank(id) { return this.tanks.get(id); }
  /** Devices wired to a pack. */
  dependents(packId) { return [...this.devices.values()].filter((d) => d.pack === packId); }
  /** A device works when it's switched on and its pack has charge. */
  isOn(id) { const d = this.devices.get(id); return !!d && d.wantOn && !this.packs.get(d.pack)?.flat; }
  available(id) { const d = this.devices.get(id); return !!d && !this.packs.get(d.pack)?.flat; }

  /** Switch a device on or off. Returns { ok, reason }. */
  setDevice(id, on) {
    const d = this.devices.get(id); if (!d) return { ok: false, reason: 'no such device' };
    const p = this.packs.get(d.pack);
    if (on && p.flat) { this.notify(`${d.name} won't power up: the ${p.name} is flat. Swap in a spare pack (9) or charge it at the shed.`); return { ok: false, reason: `${p.name} flat` }; }
    if (d.wantOn !== on) { d.wantOn = on; this.trace('device', { device: id, on, pack: d.pack }); }
    return { ok: true };
  }

  /** A one-shot draw (a sonar ping). False if the pack can't supply it. */
  draw(id, amount) {
    const d = this.devices.get(id), p = d && this.packs.get(d.pack);
    if (!p || p.flat) { if (p) this.notify(`${d.name}: no power, the ${p.name} is flat. Swap in a spare pack (9) or charge it at the shed.`); return false; }
    p.charge = Math.max(0, p.charge - amount);
    this.trace('draw', { device: id, pack: p.id, amount, charge: +p.charge.toFixed(2) });
    this.checkPack(p);
    return true;
  }

  /** Rewire one device to another pack. */
  swap(id, packId) {
    const d = this.devices.get(id), p = this.packs.get(packId);
    if (!d || !p || d.pack === packId) return false;
    const from = d.pack; d.pack = packId;
    this.trace('swap', { device: id, from, to: packId });
    return true;
  }
  /** Rewire every device on a flat pack to the fullest spare. Returns the spare used, or null. */
  swapFlatToSpare() {
    const flat = [...this.packs.values()].find((p) => p.flat && !p.spare && this.dependents(p.id).length);
    if (!flat) return null;
    const spare = [...this.packs.values()].filter((p) => p.spare && !p.flat && !this.dependents(p.id).length).sort((a, b) => b.charge - a.charge)[0];
    if (!spare) { this.notify(`No charged spare pack left for the ${flat.name}. Charge it at the shed generator, or work without those devices.`); return null; }
    const moved = this.dependents(flat.id).map((d) => d.name);
    for (const d of this.dependents(flat.id)) this.swap(d.id, spare.id);
    this.notify(`Swapped in ${spare.name}: ${moved.join(', ')} back on power.`);
    return spare.id;
  }

  /** Add charge to a pack (from a generator, a charger). */
  charge(packId, amount) {
    const p = this.packs.get(packId); if (!p) return;
    p.charge = Math.min(p.capacity, p.charge + amount);
    this.checkPack(p);
  }

  /** Burn fuel from a tank; returns the litres actually burned. */
  burn(tankId, litres) {
    const t = this.tanks.get(tankId); if (!t) return 0;
    const used = Math.min(t.litres, litres);
    t.litres -= used;
    this.checkTank(t);
    return used;
  }
  /** Pour fuel from one tank into another of the same type. Returns litres moved. */
  pour(fromId, toId) {
    const a = this.tanks.get(fromId), b = this.tanks.get(toId);
    if (!a || !b) return 0;
    if (a.type !== b.type) { this.notify(`${a.name} doesn't fit the ${b.name}: wrong fuel.`); return 0; }
    const moved = Math.min(a.litres, b.capacity - b.litres);
    if (moved <= 0) return 0;
    a.litres -= moved; b.litres += moved;
    this.trace('pour', { from: fromId, to: toId, litres: +moved.toFixed(2) });
    this.checkTank(a); this.checkTank(b);
    return moved;
  }
  /** The tank as a 0..1 `fuel` fraction (what the boat reads and writes). */
  tankView(id) {
    const self = this;
    return {
      get fuel() { const t = self.tanks.get(id); return t.litres / t.capacity; },
      set fuel(v) { const t = self.tanks.get(id); t.litres = Math.max(0, Math.min(t.capacity, v * t.capacity)); self.checkTank(t); },
    };
  }

  /** Plug a pack into a generator (or unplug: null). */
  plug(packId, genId) { const p = this.packs.get(packId); if (p && p.plugged !== genId) { p.plugged = genId; this.trace('plug', { pack: packId, into: genId }); } }
  setGenerator(id, on) {
    const g = this.generators.get(id); if (!g) return false;
    if (on && this.tanks.get(g.tank).litres <= 0) { this.notify(`The ${g.name} won't start: no fuel. Pour a can into it (0).`); return false; }
    if (g.running !== on) { g.running = on; this.trace('generator', { id, on }); this.notify(on ? `${g.name} running: anything plugged in at the shed is charging. (It's loud.)` : `${g.name} off.`); }
    return true;
  }

  checkPack(p) {
    const flat = p.charge <= 1e-9;
    if (flat === p.flat) return;
    p.flat = flat;
    const deps = this.dependents(p.id).map((d) => d.name);
    this.trace(flat ? 'pack-flat' : 'pack-restored', { pack: p.id, devices: deps, charge: +p.charge.toFixed(2) });
    if (flat) this.notify(`The ${p.name} is flat: ${deps.length ? deps.join(', ') : 'nothing'} ${deps.length === 1 ? 'is' : 'are'} off. Everything else still works. Swap in a spare (9) or charge it at the shed.`);
  }
  checkTank(t) {
    const empty = t.litres <= 1e-9;
    if (empty === t.empty) return;
    t.empty = empty;
    this.trace(empty ? 'tank-empty' : 'tank-refilled', { tank: t.id, litres: +t.litres.toFixed(2) });
  }

  update(dt) {
    this.time += dt;
    for (const d of this.devices.values()) {
      if (!d.drawPerSec || !this.isOn(d.id)) continue;
      const p = this.packs.get(d.pack);
      p.charge = Math.max(0, p.charge - d.drawPerSec * dt);
      this.checkPack(p);
    }
    for (const g of this.generators.values()) {
      if (!g.running) continue;
      const used = this.burn(g.tank, g.litresPerSec * dt);
      if (used <= 0) { g.running = false; this.trace('generator', { id: g.id, on: false, why: 'out of fuel' }); this.notify(`The ${g.name} sputters out: no fuel. Pour a can into it (0).`); continue; }
      for (const p of this.packs.values()) if (p.plugged === g.id) this.charge(p.id, g.chargePerSec * dt);
    }
  }

  /** Rows for the HUD and tests: each pack with its devices, each tank. */
  status() {
    return {
      packs: [...this.packs.values()].map((p) => ({ id: p.id, name: p.name, pct: Math.round(p.charge / p.capacity * 100), flat: p.flat, spare: p.spare, plugged: p.plugged,
        devices: this.dependents(p.id).map((d) => ({ id: d.id, name: d.name, on: this.isOn(d.id), wantOn: d.wantOn })) })),
      tanks: [...this.tanks.values()].map((t) => ({ id: t.id, name: t.name, litres: +t.litres.toFixed(1), capacity: t.capacity })),
      generators: [...this.generators.values()].map((g) => ({ id: g.id, name: g.name, running: g.running })),
    };
  }
}

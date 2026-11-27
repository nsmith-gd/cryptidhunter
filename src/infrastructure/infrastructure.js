// Infrastructure and logistics state (#154; S16, GDD §1.5 L12, §5.4, §12.2 "alternative dry foot
// exit even if cargo route fails"). Pure: no three.js, no DOM.
//
// Assets are physical structures and machines: { id, kind, name, integrity 0-100, capacityKg?,
// machine?, running?, powers?: [ids] (what draws power through it), feeds?: id (its power source) }.
//   integrity    warning below 40, broken at 0 (a broken asset does nothing until repaired)
//   damage       hits one asset; the only knock-on is to assets CONNECTED to it - things that draw
//                power through a broken source go offline. Nothing else on the site changes.
//   machinery    a running machine vibrates (the creature reacts to that); a broken one stops
// Routes are ordered lists of assets you depend on to use them: { id, kind: 'cargo' | 'foot', via: [ids] }.
//   A route is open if every asset on it is intact and, carrying a load, every asset can bear it.
//   Foot routes may not depend on cargo-only assets (validated when the site is built), so a blocked
//   or failed cargo route can never close the foot exit.

export const INFRA = Object.freeze({ warn: 40 });

export class InfrastructureSite {
  constructor({ assets = [], routes = [], now = () => 0 }) {
    this.assets = new Map(assets.map((a) => [a.id, { integrity: 100, ...a, warned: false }]));
    this.routes = new Map(routes.map((r) => [r.id, { ...r }]));
    this.now = now;
    this.trace = [];
    const problems = this.validate();
    if (problems.length) throw new Error(`invalid site: ${problems.join('; ')}`);
  }

  log(type, data) { const e = { t: this.now(), type, ...data }; this.trace.push(e); return e; }
  asset(id) { return this.assets.get(id); }
  broken(id) { return (this.asset(id)?.integrity ?? 0) <= 0; }

  /** Foot routes may not depend on any asset a cargo route uses only for cargo (cargoOnly). */
  validate() {
    const out = [];
    for (const r of this.routes.values()) {
      for (const id of r.via) if (!this.assets.has(id)) out.push(`${r.id} uses unknown asset ${id}`);
      if (r.kind === 'foot') for (const id of r.via) if (this.asset(id)?.cargoOnly) out.push(`foot route ${r.id} depends on cargo-only ${id}`);
    }
    return out;
  }

  /** Has power: no source, or its source is intact (and itself powered). */
  powered(id, seen = new Set()) {
    const a = this.asset(id);
    if (!a?.feeds) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return !this.broken(a.feeds) && (this.asset(a.feeds).running ?? true) && this.powered(a.feeds, seen);
  }
  /** Working: intact and, if it needs power, powered. */
  working(id) { return !this.broken(id) && this.powered(id); }

  /** Damage one asset. Returns { asset, integrity, broke, affected: [ids that lost power because of it] }. */
  damage(id, amount, cause = 'damage') {
    const a = this.asset(id);
    if (!a || a.integrity <= 0) return { asset: id, integrity: a?.integrity ?? 0, broke: false, affected: [] };
    const before = new Map([...this.assets.keys()].map((k) => [k, this.working(k)]));
    a.integrity = Math.max(0, a.integrity - amount);
    this.log('damage', { asset: id, amount, cause, integrity: Math.round(a.integrity) });
    if (a.integrity < INFRA.warn && !a.warned && a.integrity > 0) { a.warned = true; this.log('warning', { asset: id, integrity: Math.round(a.integrity) }); }
    const broke = a.integrity <= 0;
    if (broke) { if (a.machine) a.running = false; this.log('broken', { asset: id, cause }); }
    const affected = [...this.assets.keys()].filter((k) => k !== id && before.get(k) && !this.working(k));
    for (const k of affected) this.log('offline', { asset: k, because: id });
    return { asset: id, integrity: a.integrity, broke, affected };
  }

  repair(id, amount = 100) {
    const a = this.asset(id);
    a.integrity = Math.min(100, a.integrity + amount);
    if (a.integrity >= INFRA.warn) a.warned = false;
    this.log('repair', { asset: id, integrity: Math.round(a.integrity) });
    return a.integrity;
  }

  setRunning(id, on) {
    const a = this.asset(id);
    if (!a?.machine) return false;
    if (on && !this.working(id)) { this.log('refused', { asset: id, why: 'broken or unpowered' }); return false; }
    a.running = on; this.log(on ? 'started' : 'stopped', { asset: id });
    return true;
  }

  /** Machines running right now (and intact): what a creature that hunts vibration can feel. */
  vibrationSources() { return [...this.assets.values()].filter((a) => a.machine && a.running && this.working(a.id)).map((a) => ({ id: a.id, x: a.x, z: a.z })); }

  /** Is the route usable, carrying loadKg? { open, why }. */
  routeOpen(routeId, loadKg = 0) {
    const r = this.routes.get(routeId);
    if (!r) return { open: false, why: `no route ${routeId}` };
    if (r.blocked) return { open: false, why: r.blocked };
    for (const id of r.via) {
      const a = this.asset(id);
      if (!this.working(id)) return { open: false, why: `${a.name ?? id} is ${this.broken(id) ? 'broken' : 'without power'}` };
      if (loadKg > 0 && a.capacityKg != null && loadKg > a.capacityKg) return { open: false, why: `${a.name ?? id} can't take ${loadKg} kg (limit ${a.capacityKg} kg)` };
    }
    return { open: true };
  }

  /** Block or clear a route from outside (flood, fallen tree). Only that route. */
  block(routeId, why) { this.routes.get(routeId).blocked = why; this.log('blocked', { route: routeId, why }); }
  clear(routeId) { this.routes.get(routeId).blocked = null; this.log('cleared', { route: routeId }); }

  /** Every exit you could still use on foot. */
  footExits() { return [...this.routes.values()].filter((r) => r.kind === 'foot' && this.routeOpen(r.id).open).map((r) => r.id); }
}

/** The L12 floodplain fixture (greybox numbers): what the Grafton site is made of. */
export function graftonSite(now) {
  return new InfrastructureSite({
    now,
    assets: [
      { id: 'generator', kind: 'machine', name: 'the generator', machine: true, running: true, x: 4, z: -2 },
      { id: 'winch', kind: 'machine', name: 'the cargo winch', machine: true, running: false, feeds: 'generator', cargoOnly: true, capacityKg: 2000, x: 8, z: 0 },
      { id: 'lights', kind: 'fixture', name: 'the floodlights', feeds: 'generator', x: 0, z: 0 },
      { id: 'pad', kind: 'structure', name: 'the staging pad', capacityKg: 3000, cargoOnly: true, x: 10, z: 4 },
      { id: 'bridge', kind: 'structure', name: 'the cargo bridge', capacityKg: 2500, cargoOnly: true, x: 30, z: 10 },
      { id: 'footbridge', kind: 'structure', name: 'the footbridge', capacityKg: 300, x: -20, z: 16 },
      { id: 'shelter', kind: 'structure', name: 'the field shelter', x: -4, z: 4 },
    ],
    routes: [
      { id: 'cargo', kind: 'cargo', name: 'the heavy cargo route', via: ['pad', 'winch', 'bridge'] },
      { id: 'foot', kind: 'foot', name: 'the pedestrian escape', via: ['footbridge'] },
    ],
  });
}

import { Thermoregulation, THERMO } from './thermoregulation.js';
import { Nutrition } from './nutrition.js';
import { Health, HEALTH } from './health.js';

// Survival systems for the tutorial tier (GDD 1.2 S01 Nutrition, S02 Thermoregulation).
// Each system owns its own state; this module steps them in the GDD order (environment first,
// then demands from the prior snapshot), derives the player's stamina-recovery multiplier
// (GDD 2.8: recovery = base × max(0.25, 1 − hunger − thermal)), and shows the HUD + warnings.
// Z eats.

export class Survival {
  constructor({ player, input, map, heatSources, food }) {
    this.player = player;
    this.thermo = new Thermoregulation({ player, airTemp: map.environment?.airTemp ?? 6, heatSources, surfaceAt: map.surfaceAt });
    this.nutrition = new Nutrition({ player, food, getCold: () => this.thermo.coldDeficit });
    // S08: the only damage path. onDeath is set by the hunt (health 0 ends it).
    this.health = new Health({ onDeath: (cause) => this.onDeath?.(cause) });
    this.shown = new Set();
    this.buildHud();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyZ' && !e.repeat && input.locked) this.eat();
      if (e.code === 'KeyB' && !e.repeat && input.locked) this.bandage();
    });
  }

  eat() {
    const r = this.nutrition.eat();
    this.toast(r ? `Ate a ${r.name.toLowerCase()} (+${r.energy} energy)` : 'No food left');
    return r;
  }

  bandage() {
    const h = this.health;
    const ok = h.bandage();
    this.toast(ok ? 'Bandaging the wound…' : !h.bleeding.length ? 'Nothing to bandage' : h.firstAid <= 0 ? 'No first-aid kits left' : 'Already bandaging');
    return ok;
  }

  update(dt) {
    this.thermo.update(dt);
    this.nutrition.update(dt);
    this.health.update(dt);
    const hunger = this.nutrition.hungerDeficit * 0.5, cold = this.thermo.coldDeficit * 0.6;
    this.player.recoveryScale = Math.max(0.25, 1 - hunger - cold);
  }

  /** Every active warning, each naming its cause. */
  warnings() { return [...this.health.warnings(), ...this.thermo.warnings(), ...this.nutrition.warnings()]; }

  // --- HUD -------------------------------------------------------------------------------
  buildHud() {
    const css = document.createElement('style');
    css.textContent = `
#survival { position: fixed; left: 8px; top: 64px; font: 11px monospace; color: #ccc; text-shadow: 0 0 2px #000; pointer-events: none; }
#survival .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
#survival .row > span:first-child { width: 58px; }
#survival .track { width: 120px; height: 8px; background: #0008; border: 1px solid #888; }
#survival .fill { height: 100%; }
#survival .warn { margin-top: 4px; max-width: 250px; }
#survival .warn div { padding: 1px 0; }
#survival .warn .l1 { color: #ffd88a; } #survival .warn .l2 { color: #ff8a7a; } #survival .warn .l0 { color: #bbb; }
#survival-toast { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); font: 13px monospace; color: #f1e6c8;
  text-shadow: 0 0 3px #000; pointer-events: none; opacity: 0; transition: opacity .5s; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'survival' });
    this.el.innerHTML = `
      <div class="row"><span>HEALTH</span><div class="track"><div class="fill h"></div></div><span class="hn"></span></div>
      <div class="row"><span>ENERGY</span><div class="track"><div class="fill e"></div></div><span class="en"></span></div>
      <div class="row"><span>BODY</span><div class="track"><div class="fill t"></div></div><span class="tn"></span></div>
      <div class="warn"></div>`;
    this.toastEl = Object.assign(document.createElement('div'), { id: 'survival-toast' });
    document.body.append(this.el, this.toastEl);
  }

  render() {
    const n = this.nutrition, t = this.thermo, h = this.health;
    const hf = this.el.querySelector('.fill.h');
    hf.style.width = `${(h.value / HEALTH.max * 100).toFixed(1)}%`;
    hf.style.background = h.value <= 15 ? '#ff3a2a' : h.bleeding.length ? '#e05050' : h.value <= 40 ? '#e0a040' : '#d8e0d0';
    this.el.querySelector('.hn').textContent = `${Math.ceil(h.value)}${h.bleeding.length ? ' BLEEDING' : ''} · aid ${h.firstAid} (B)`;
    const e = this.el.querySelector('.fill.e'), tf = this.el.querySelector('.fill.t');
    e.style.width = `${n.energy.toFixed(1)}%`;
    e.style.background = n.energy <= 25 ? '#c0504d' : n.energy <= 50 ? '#e0a040' : '#8fd07a';
    this.el.querySelector('.en').textContent = `${Math.round(n.energy)} · food ${n.foodLeft} (Z)`;
    const frac = (t.core - THERMO.floor) / (THERMO.ceiling - THERMO.floor);
    tf.style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
    tf.style.background = t.core < THERMO.coldBelow ? '#6aa8ff' : t.core < THERMO.comfortLow ? '#a8c8ff' : '#f0c070';
    this.el.querySelector('.tn').textContent = `${t.core.toFixed(1)}°C${t.wetness >= 5 ? ` · wet ${Math.round(t.wetness)}%` : ''}${t.nearHeat ? ' · warming' : ''}`;
    const w = this.warnings();
    const html = w.map((x) => `<div class="l${x.level}">⚠ ${x.text}</div>`).join('');
    const box = this.el.querySelector('.warn');
    if (box.innerHTML !== html) box.innerHTML = html;
    // A new warning also flashes once in the middle of the screen.
    for (const x of w) if (x.level >= 1 && !this.shown.has(x.id)) { this.shown.add(x.id); this.toast(x.text); }
    for (const id of [...this.shown]) if (!w.some((x) => x.id === id)) this.shown.delete(id);
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.style.transition = 'none'; this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.style.transition = 'opacity .8s'; this.toastEl.style.opacity = '0'; }, 2500);
  }
}

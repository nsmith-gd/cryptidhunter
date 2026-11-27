// Player status (GDD 2.11, 13.1): one read-only view over every system that affects the player.
// It owns no state: it reads health and wounds (S08), stamina (player), energy (S01 nutrition), body temperature and
// wetness (S02 thermoregulation), fear, and torch power, then names for each condition:
//   cause  - the root cause ("Wet clothing", "Darkness"), never a downstream symptom;
//   effect - what it does to you now, or what it is about to do;
//   fix    - the recovery action.
// Every condition has a 'soon' stage that appears BEFORE its penalty applies and a 'now' stage
// once it does. Labels are words (SOON / NOW, severity names), never colour or sound alone.

import { THERMO } from '../survival/thermoregulation.js';
import { FEAR } from '../hunt/fear.js';
import { FLASHLIGHT } from '../flashlight.js';

export const STATUS = {
  hungerSoon: 60,          // energy: penalty starts at 50 (stamina recovery slows)
  hungerNow: 50,
  coolingMargin: 0.35,     // °C above the chill line where "cooling down" warns, if heading down
  windedSoon: 0.3,         // stamina fraction while sprinting
  fearSoon: 25,            // fear: aim starts to sway at FEAR.swayStart (35)
  batterySoon: 0.3,        // torch: dims at FLASHLIGHT.lowLevel (0.15)
};
const SEVERITY = ['notice', 'warning', 'danger'];

export class StatusModel {
  constructor({ player, survival = null, fear = null, flashlight = null }) {
    this.player = player;
    this.survival = survival;
    this.fear = fear;
    this.flashlight = flashlight;
  }

  /** Root cause of losing heat right now. */
  heatCause() {
    const t = this.survival.thermo;
    if (t.inWater === 'deep') return 'Deep water';
    if (t.inWater === 'shallow') return 'Standing in water';
    if (t.wetness >= 30) return 'Wet clothing';
    return 'Cold night air';
  }

  conditions() {
    const out = [];
    const add = (c) => out.push({ ...c, severityName: SEVERITY[c.severity] });
    const p = this.player, s = this.survival, f = this.fear, fl = this.flashlight;
    const recovery = Math.round((p.recoveryScale ?? 1) * 100);

    if (s?.health) {   // S08 (#72): wounds come first, they're the only thing that can end the hunt
      const h = s.health, bleeding = h.bleeding;
      const fixWound = h.firstAid ? `Bandage it (B): ${h.firstAid} first-aid kit${h.firstAid === 1 ? '' : 's'} left` : 'No first-aid left: get back to the van';
      if (bleeding.length) {
        const heavy = bleeding.some((c) => c.severity === 'heavy');
        add({ id: 'bleeding', stage: 'now', severity: 2, name: heavy ? 'Heavy bleeding' : 'Bleeding',
          cause: `Wound from ${bleeding[0].cause}`, effect: `Losing health (${Math.ceil(h.value)} left): at 0 the hunt is over`, fix: fixWound });
      }
      if (h.value <= 40 && !h.dead) {
        add({ id: 'hurt', stage: 'now', severity: h.value <= 15 ? 2 : 1, name: h.value <= 15 ? 'Critically hurt' : 'Badly hurt',
          cause: h.conditions.length ? `Injured by ${h.conditions[h.conditions.length - 1].cause}` : 'Injured', effect: 'Another hit could end the hunt',
          fix: 'Keep your distance and head back to the van' });
      }
    }

    if (s) {
      const n = s.nutrition, t = s.thermo;
      const food = n.foodLeft ? `Eat something (Z): ${n.foodLeft} food left` : 'No food left: head back to the van';
      if (n.energy <= STATUS.hungerNow) {
        add({ id: 'hunger', stage: 'now', severity: n.energy <= 25 ? 2 : 1, name: n.energy <= 25 ? 'Very hungry' : 'Hungry',
          cause: `Energy reserve low (${Math.round(n.energy)})`, effect: `Stamina recovers ${100 - recovery}% slower`, fix: food });
      } else if (n.energy <= STATUS.hungerSoon) {
        add({ id: 'hunger', stage: 'soon', severity: 0, name: 'Getting hungry',
          cause: `Energy reserve dropping (${Math.round(n.energy)})`, effect: `Stamina recovery will slow below ${STATUS.hungerNow}`, fix: food });
      }

      if (t.inWater !== 'dry') {
        add({ id: 'soaking', stage: t.wetness >= 30 ? 'now' : 'soon', severity: t.inWater === 'deep' ? 2 : 1, name: t.inWater === 'deep' ? 'Deep water' : 'Wading',
          cause: t.inWater === 'deep' ? 'Deep water' : 'Standing in water', effect: 'Your clothes are soaking through: you will lose heat faster',
          fix: 'Get out of the water: use the footbridge or stepping stones' });
      }
      if (t.wetness >= 30) {
        const lost = Math.round(60 * t.wetness / 100);
        add({ id: 'wet', stage: 'now', severity: t.wetness >= 70 ? 2 : 1, name: 'Wet clothing',
          cause: 'Wet clothing', effect: `Losing heat faster (jacket insulates ${lost}% worse)`,
          fix: t.nearHeat ? `Drying off by the ${t.nearHeat}` : 'Dry off by a fire, in the cabin or in the van' });
      }
      const fixCold = t.nearHeat ? `Warming up by the ${t.nearHeat}: stay a while` : t.wetness >= 30 ? 'Get dry and warm up by a fire, the cabin or the van' : 'Keep moving, or warm up by a fire, the cabin or the van';
      // Ordinary expeditions (#89): critical cold drains health. SOON before it starts, NOW while it does.
      if (t.lethal && t.core < THERMO.hypothermiaSoon) {
        const now = t.core < THERMO.criticalBelow;
        add({ id: 'hypothermia', stage: now ? 'now' : 'soon', severity: 2, name: now ? 'Hypothermic' : 'Dangerously cold',
          cause: this.heatCause(), effect: now ? `Body ${t.core.toFixed(1)}°C: you are losing health` : `Body ${t.core.toFixed(1)}°C: below ${THERMO.criticalBelow}°C you start losing health`, fix: fixCold });
      }
      if (t.core < THERMO.comfortLow) {
        const band = t.core < THERMO.severeBelow ? 'Very cold' : t.core < THERMO.coldBelow ? 'Cold' : 'Chilly';
        add({ id: 'cold', stage: 'now', severity: t.core < THERMO.severeBelow ? 2 : t.core < THERMO.coldBelow ? 1 : 0, name: band,
          cause: this.heatCause(), effect: `Body ${t.core.toFixed(1)}°C: stamina recovers ${100 - recovery}% slower${t.core < THERMO.coldBelow ? ', shivering' : ''}`, fix: fixCold });
      } else if ((t.equilibrium ?? THERMO.target) < THERMO.comfortLow && t.core < THERMO.comfortLow + STATUS.coolingMargin) {
        add({ id: 'cold', stage: 'soon', severity: 0, name: 'Cooling down',
          cause: this.heatCause(), effect: `Body ${t.core.toFixed(1)}°C and falling: stamina recovery will slow below ${THERMO.comfortLow}°C`, fix: fixCold });
      }
    }

    if (p.exhausted) {
      add({ id: 'winded', stage: 'now', severity: 1, name: 'Winded', cause: 'Sprinted until out of breath',
        effect: "Can't sprint until you catch your breath", fix: 'Walk or stand still to recover' });
    } else if (p.sprinting && p.stamina < STATUS.windedSoon) {
      add({ id: 'winded', stage: 'soon', severity: 0, name: 'Out of breath soon', cause: 'Sprinting',
        effect: 'Sprint will lock when stamina runs out', fix: 'Ease off to a walk' });
    }

    if (f) {
      const cause = f.reasons?.includes('cryptid near') ? 'Something big is close'
        : f.reasons?.includes('dark') ? 'Darkness: your torch is off'
          : f.lastReason ? `Scare: ${String(f.lastReason).replace(/\b\w/g, (c) => c.toUpperCase())}` : 'Nerves';
      const fixFear = 'Turn your torch on, stand in lamplight, or get back to the van';
      if (f.value > FEAR.swayStart) {
        add({ id: 'fear', stage: 'now', severity: f.value > 70 ? 2 : 1, name: f.value > 70 ? 'Terrified' : 'Scared',
          cause, effect: 'Your hands shake: aim sways and photos blur', fix: fixFear });
      } else if (f.value > STATUS.fearSoon && (f.rate ?? 0) > 0) {
        add({ id: 'fear', stage: 'soon', severity: 0, name: 'Uneasy', cause, effect: 'If it keeps rising, your aim will start to sway', fix: fixFear });
      }
    }

    if (fl) {
      const spares = fl.spares > 0 ? `Swap in a spare battery (R): ${fl.spares} left` : 'No spares left: switch the torch off (F) to save it';
      if (fl.battery <= 0) {
        add({ id: 'battery', stage: 'now', severity: 2, name: 'Torch dead', cause: 'Battery empty', effect: 'No light', fix: spares });
      } else if (fl.battery < FLASHLIGHT.lowLevel) {
        add({ id: 'battery', stage: 'now', severity: 1, name: 'Torch failing', cause: 'Battery nearly empty', effect: 'Beam dims and flickers', fix: spares });
      } else if (fl.battery < STATUS.batterySoon && fl.on) {
        add({ id: 'battery', stage: 'soon', severity: 0, name: 'Battery low', cause: 'Battery running down', effect: `Beam will dim in about ${this.torchMinutes(FLASHLIGHT.lowLevel)}`, fix: spares });
      }
    }
    return out.sort((a, b) => b.severity - a.severity || (a.stage === 'now' ? -1 : 1));
  }

  torchMinutes(down = 0) {
    const fl = this.flashlight, s = Math.max(0, (fl.battery - down) * (fl.batteryLife ?? FLASHLIGHT.batteryLife));
    return s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
  }

  attributes() {
    const p = this.player, s = this.survival, f = this.fear, fl = this.flashlight;
    const a = [{ id: 'stamina', name: 'Stamina', value: p.stamina, text: `${Math.round(p.stamina * 100)}%${p.exhausted ? ' (winded)' : ''}` }];
    if (s?.health) a.push({ id: 'health', name: 'Health', value: s.health.value / 100, text: `${Math.ceil(s.health.value)} (${s.health.band})${s.health.bleeding.length ? ' · bleeding' : ''} · ${s.health.firstAid} first-aid` });
    if (s) {
      const n = s.nutrition, t = s.thermo;
      a.push({ id: 'energy', name: 'Energy', value: n.energy / 100, text: `${Math.round(n.energy)} (${n.band})` });
      const trend = (t.equilibrium ?? t.core) < t.core - 0.02 ? ', cooling' : (t.equilibrium ?? t.core) > t.core + 0.02 ? ', warming' : '';
      a.push({ id: 'temperature', name: 'Body temperature', value: (t.core - THERMO.floor) / (THERMO.ceiling - THERMO.floor), text: `${t.core.toFixed(1)}°C (${t.band}${trend})` });
      a.push({ id: 'wetness', name: 'Wetness', value: t.wetness / 100, text: `${Math.round(t.wetness)}%${t.wetness < 5 ? ' (dry)' : ''}` });
    }
    if (f) a.push({ id: 'fear', name: 'Fear', value: f.value / 100, text: `${Math.round(f.value)} (${f.value > 70 ? 'terrified' : f.value > FEAR.swayStart ? 'scared' : f.value > STATUS.fearSoon ? 'uneasy' : 'calm'})` });
    if (fl) a.push({ id: 'battery', name: 'Torch battery', value: fl.battery, text: `${Math.round(fl.battery * 100)}% · ${this.torchMinutes()} of light · ${fl.spares} spare${fl.spares === 1 ? '' : 's'}` });
    return a;
  }

  /** What you can do right now, given all of the above. */
  capability() {
    const p = this.player, f = this.fear;
    return [
      `Stamina recovery: ${Math.round((p.recoveryScale ?? 1) * 100)}% of normal`,
      `Sprint: ${p.exhausted ? 'locked until you catch your breath' : 'ready'}`,
      `Aim: ${f && f.value > FEAR.swayStart ? 'shaky (photos may blur)' : 'steady'}`,
      ...(this.flashlight ? [`Light: ${this.flashlight.on ? `on, about ${this.torchMinutes()} left in this battery` : 'off'}`] : []),
    ];
  }

  /** Compact HUD lines: { id, level, text } (consolidated root causes, worded stage). */
  hudWarnings(max = 4) {
    return this.conditions().slice(0, max).map((c) => ({
      id: `${c.id}-${c.stage}`, level: c.stage === 'soon' ? Math.max(1, c.severity) : c.severity,
      text: `${c.stage === 'soon' ? 'SOON' : 'NOW'} · ${c.cause}: ${c.effect.charAt(0).toLowerCase()}${c.effect.slice(1)}. ${c.fix}`,
    }));
  }
}

// Map / target selection (L1). The start screen lists the hunting grounds; each has a target
// cryptid. Unlocks (#101, GDD 6.4/7.1): the next destination opens after a successful extraction
// from the previous one plus its target's Documented research milestone, and only while you can
// afford the trip. Picking an unlocked map remembers it at base camp and reloads into it.
// (`?map=` in the address is a developer override and skips locks.)
import { unlockStatus } from '../research/dossier.js';

export const MAP_CHOICES = [
  // Level 9 (#147, GDD 1.5 L09): the Pine Barrens, $15,000 trip. Greybox; reachable with ?map=pinebarrens
  // (unlock follows the career like every level: after Point Pleasant's Mothman).
  { id: 'pinebarrens', name: 'Pine Barrens', target: 'Jersey Devil', level: 9, tripCents: 1500000,
    after: { map: 'pointpleasant', mapName: 'Point Pleasant', species: 'mothman', speciesName: 'Mothman' },
    blurb: 'Flat sand and pitch pines. Something patrols the open sky: stay under the canopy, and keep your light low.' },
  { id: 'forest', name: 'Pine Hollow Forest', target: 'Bigfoot', level: 1,
    blurb: 'Dense night pines, a creek and a ridge. Bigfoot beds down past the ridge.' },
  // Level 2 (#129, GDD 6.2): a daylight trip into the Oro-Medonte hills, $75 operating cost.
  { id: 'oromedonte', name: 'Oro-Medonte Woods', target: 'Sidehill Gouger', level: 2, tripCents: 7500,
    after: { map: 'forest', mapName: 'Pine Hollow', species: 'bigfoot', speciesName: 'Bigfoot' },
    blurb: 'Rolling hills, a lake and one trail from the car. Back before dusk, or find your way in the dark.' },
  // Trip cost $40 is a placeholder until the economy defines L02's operating cost (assumption).
  { id: 'swamp', name: 'Blackwater Swamp', target: 'Mothman', level: 2, tripCents: 4000,
    after: { map: 'forest', mapName: 'Pine Hollow', species: 'bigfoot', speciesName: 'Bigfoot' },
    blurb: 'Boardwalks over black water and the old bridge. Something circles overhead.' },
];

export const TARGET_BY_MAP = { test: 'Bigfoot', forest: 'Bigfoot', swamp: 'Mothman', oromedonte: 'Sidehill Gouger', simcoe: 'Igopogo', l05: 'Mugwump', ozark: 'Ozark Howler', pointpleasant: 'Mothman', pinebarrens: 'Jersey Devil', cobaltgym: 'Old Yellow Top' };   // simcoe: L03 greybox, ?map=simcoe (#135)

/** What the unlock rule reads from base camp. */
export function unlockContext(camp) {
  return { research: camp.state.research, extractedFrom: camp.state.extractedFrom ?? [], moneyCents: Math.round((camp.state.money ?? 0) * 100) };
}
export function isUnlocked(choice, ctx) { return unlockStatus(choice, ctx).open; }

/**
 * Which map to load: the address wins (dev override), then base camp's remembered choice if it's
 * still unlocked, else the default test yard.
 */
export function resolveMap(search, camp) {
  const url = new URLSearchParams(search).get('map');
  if (url) return url;
  const saved = MAP_CHOICES.find((c) => c.id === camp.state.map);
  return saved && isUnlocked(saved, unlockContext(camp)) ? saved.id : 'test';
}

/** "CHOOSE YOUR HUNT" panel on the start screen. onPick(id) is called for an unlocked map. */
export function showMapPicker({ current, ctx, onPick, root = document.querySelector('#overlay > div') }) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'map-picker';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.5 monospace', color: '#ddd' });
  el.innerHTML = `<div>CHOOSE YOUR HUNT  ·  credibility ${ctx.research?.credibility ?? 0}</div>` + MAP_CHOICES.map((c) => {
    const st = unlockStatus(c, ctx), open = st.open, here = c.id === current;
    return `<button data-id="${c.id}" ${open ? '' : 'disabled'} style="display:block;width:100%;text-align:left;margin-top:4px;
      font:12px monospace;padding:4px 8px;cursor:${open ? 'pointer' : 'not-allowed'};border:1px solid ${here ? '#ffd88a' : '#555'};
      background:${here ? '#2b2116' : open ? '#222' : '#151515'};color:${open ? '#eee' : '#777'}">
      <b>${c.name}</b> — target: ${c.target}${here ? '  ✓ selected' : ''}${open ? '' : `  🔒 needs ${st.reasons.join(' + ')}`}<br>
      <span style="color:#999">${c.blurb}</span></button>`;
  }).join('');
  el.addEventListener('click', (e) => {
    e.stopPropagation();                       // don't start the hunt
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.id !== current) onPick?.(b.dataset.id);
  });
  const after = root.querySelector('#camp-panel');
  if (after) after.after(el); else root.prepend(el);
  return el;
}

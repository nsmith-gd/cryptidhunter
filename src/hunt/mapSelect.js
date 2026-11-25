// Map / target selection (L1). The start screen lists the hunting grounds; each has a target
// cryptid and a reputation needed to unlock it. Picking an unlocked map remembers it at base
// camp and reloads into it. (`?map=` in the address is a developer override and skips locks.)

export const MAP_CHOICES = [
  { id: 'forest', name: 'Pine Hollow Forest', target: 'Bigfoot', reputation: 0,
    blurb: 'Dense night pines, a creek and a ridge. Bigfoot beds down past the ridge.' },
  { id: 'swamp', name: 'Blackwater Swamp', target: 'Mothman', reputation: 2,
    blurb: 'Boardwalks over black water and the old bridge. Something circles overhead.' },
];

export const TARGET_BY_MAP = { test: 'Bigfoot', forest: 'Bigfoot', swamp: 'Mothman' };

export function isUnlocked(choice, reputation) { return reputation >= choice.reputation; }

/**
 * Which map to load: the address wins (dev override), then base camp's remembered choice if it's
 * still unlocked, else the default test yard.
 */
export function resolveMap(search, camp) {
  const url = new URLSearchParams(search).get('map');
  if (url) return url;
  const saved = MAP_CHOICES.find((c) => c.id === camp.state.map);
  return saved && isUnlocked(saved, camp.state.reputation ?? 0) ? saved.id : 'test';
}

/** "CHOOSE YOUR HUNT" panel on the start screen. onPick(id) is called for an unlocked map. */
export function showMapPicker({ current, reputation, onPick, root = document.querySelector('#overlay > div') }) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'map-picker';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.5 monospace', color: '#ddd' });
  el.innerHTML = `<div>CHOOSE YOUR HUNT  ·  reputation ${reputation}</div>` + MAP_CHOICES.map((c) => {
    const open = isUnlocked(c, reputation), here = c.id === current;
    return `<button data-id="${c.id}" ${open ? '' : 'disabled'} style="display:block;width:100%;text-align:left;margin-top:4px;
      font:12px monospace;padding:4px 8px;cursor:${open ? 'pointer' : 'not-allowed'};border:1px solid ${here ? '#ffd88a' : '#555'};
      background:${here ? '#2b2116' : open ? '#222' : '#151515'};color:${open ? '#eee' : '#777'}">
      <b>${c.name}</b> — target: ${c.target}${here ? '  ✓ selected' : ''}${open ? '' : `  🔒 needs reputation ${c.reputation}`}<br>
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

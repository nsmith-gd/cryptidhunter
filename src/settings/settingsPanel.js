import { ACTIONS, DEFAULT_SETTINGS, LIMITS, keyFor, keyLabel, rebind } from './settings.js';
import { PAD_LAYOUT } from './gamepad.js';

// Settings panel on the start / pause screen (#76). Esc during a hunt returns to this screen.
// Click a key to rebind it, then press the new key (Esc cancels); a key already in use swaps.

export function showSettingsPanel(settings, { root = document.querySelector('#overlay > div') } = {}) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'settings-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.7 monospace', color: '#ddd', cursor: 'default' });
  let open = false, waiting = null;
  const slider = (k, label, step, fmt = (v) => v) => `<label style="display:flex;gap:8px;align-items:center">
    <span style="width:150px">${label}</span><input type="range" data-k="${k}" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" step="${step}" value="${settings.get(k)}">
    <span style="width:60px">${fmt(settings.get(k))}</span></label>`;
  const check = (k, label, note) => `<label style="display:block"><input type="checkbox" data-k="${k}" ${settings.get(k) ? 'checked' : ''}> ${label} <span style="color:#888">${note}</span></label>`;
  const render = () => {
    if (!open) { el.innerHTML = '<button data-act="open" style="font:12px monospace;cursor:pointer;padding:2px 8px">SETTINGS ▸</button> <span style="color:#888">field of view, look, brightness, captions, keys, gamepad</span>'; return; }
    const s = settings.values;
    el.innerHTML = `<div><button data-act="close" style="font:12px monospace;cursor:pointer;padding:2px 8px">SETTINGS ▾</button></div>` +
      slider('fov', 'Field of view', 1, (v) => `${v}°`) +
      slider('lookSensitivity', 'Mouse look', 0.05, (v) => `×${(+v).toFixed(2)}`) +
      slider('padLookSpeed', 'Gamepad look', 0.05, (v) => `×${(+v).toFixed(2)}`) +
      slider('brightness', 'Brightness (display)', 0.05, (v) => `×${(+v).toFixed(2)}`) +
      check('invertY', 'Invert vertical look', '') +
      check('reducedShake', 'Reduce camera shake', '(on-screen sway and bob only; a shaking hand still blurs photos)') +
      check('captions', 'Captions for sounds', '(with a direction arrow)') +
      `<div style="color:#888">Brightness changes the picture only: what the creatures can see doesn't change.</div>` +
      `<div style="margin-top:6px">KEYS <span style="color:#888">click one, then press the new key (Esc cancels)</span>
        <button data-act="reset-keys" style="font:11px monospace;cursor:pointer;margin-left:8px">reset keys</button>
        <button data-act="reset-all" style="font:11px monospace;cursor:pointer">reset everything</button></div>` +
      `<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:2px 10px">` +
      ACTIONS.map((a) => `<div>${a.name} <button data-bind="${a.id}" style="font:11px monospace;cursor:pointer;min-width:58px;
        background:${waiting === a.id ? '#ffd88a' : s.bindings[a.id] ? '#8ab8ff' : '#333'};color:${waiting === a.id || s.bindings[a.id] ? '#111' : '#ddd'}">
        ${waiting === a.id ? 'press…' : keyLabel(keyFor(s, a.id))}</button></div>`).join('') + `</div>` +
      `<div style="margin-top:6px">GAMEPAD <span style="color:#888">(press A or Menu on this screen to play with the pad)</span></div>` +
      `<div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:0 10px;color:#bbb">` +
      PAD_LAYOUT.map(([b, a]) => `<div><span style="color:#ffd88a">${b}</span> ${a}</div>`).join('') + `</div>`;
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();                      // don't start the hunt
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'open') open = true;
    if (b.dataset.act === 'close') open = false;
    if (b.dataset.act === 'reset-keys') settings.set({ bindings: {} });
    if (b.dataset.act === 'reset-all') settings.replace({ ...DEFAULT_SETTINGS });
    if (b.dataset.bind) waiting = b.dataset.bind;
    render();
  });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    settings.set({ [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value });
    const out = e.target.nextElementSibling;
    if (out && e.target.type === 'range') out.textContent = { fov: `${e.target.value}°` }[k] ?? `×${(+e.target.value).toFixed(2)}`;
  });
  el.addEventListener('change', (e) => { if (e.target.type === 'checkbox') render(); });
  // Rebinding: the next real key press (before the key remapper translates it).
  addEventListener('keydown', (e) => {
    if (!waiting || !e.isTrusted) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.code !== 'Escape') settings.replace(rebind(settings.values, waiting, e.code));
    waiting = null;
    render();
  }, true);
  render();
  const after = root.querySelector('#loadout-picker') ?? root.querySelector('#camp-panel');
  if (after) after.after(el); else root.append(el);
  return { el, open: () => { open = true; render(); }, get waiting() { return waiting; }, set waiting(v) { waiting = v; render(); } };
}

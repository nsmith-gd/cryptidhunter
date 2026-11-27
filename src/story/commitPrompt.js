import { COMMITMENT } from './finale.js';

// The final commitment prompt (#156): a full-screen, explicit warning. "Turn back" is the default
// (Esc / T, or the button); going on needs a deliberate choice (G, or the "Go on" button). It never
// appears anywhere but the final site, and it's the only way into the authored ending.
export function showCommitPrompt({ onConfirm, onCancel }) {
  const el = document.createElement('div');
  el.id = 'commit-prompt';
  Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '70', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.82)', color: '#e8e0d0', font: '15px/1.6 monospace' });
  el.innerHTML = `<div style="max-width:560px;padding:26px 30px;border:1px solid #6a5a4a;background:#0c0b0a">
    <div style="font-size:20px;color:#e8c890;margin-bottom:12px">${COMMITMENT.title}</div>
    ${COMMITMENT.body.map((p) => `<p style="margin:0 0 10px">${p}</p>`).join('')}
    <div style="display:flex;gap:14px;margin-top:18px">
      <button data-a="cancel" autofocus style="font:15px monospace;padding:8px 16px;background:#2a3a2a;color:#e8f0e0;border:1px solid #6a8a6a;cursor:pointer">${COMMITMENT.cancel} (T)</button>
      <button data-a="confirm" style="font:15px monospace;padding:8px 16px;background:#3a1a14;color:#f0d8d0;border:1px solid #8a4a3a;cursor:pointer">${COMMITMENT.confirm} (G)</button>
    </div></div>`;
  const close = (fn) => { removeEventListener('keydown', key, true); el.remove(); fn?.(); };
  const key = (e) => {
    if (e.code === 'KeyG') { e.stopPropagation(); close(onConfirm); }
    else if (e.code === 'KeyT' || e.code === 'Escape') { e.stopPropagation(); close(onCancel); }
  };
  el.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'confirm') close(onConfirm); if (a === 'cancel') close(onCancel); });
  addEventListener('keydown', key, true);
  document.body.append(el);
  return { el, confirm: () => close(onConfirm), cancel: () => close(onCancel) };
}

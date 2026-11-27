import { CLUES_FOR_VERDICT, confidenceWord } from './clueEvidence.js';
import { formatAge } from './journal.js';

const CSS = `
#examine-prompt { position: fixed; left: 50%; top: calc(50% + 22px); transform: translateX(-50%);
  color: #f1e6c8; font: 13px monospace; text-shadow: 0 0 3px #000, 0 0 2px #000; pointer-events: none; display: none; }
#journal-toast { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); padding: 6px 12px;
  background: #2b2116e6; color: #f1e6c8; font: 13px monospace; border: 1px solid #7a6440;
  pointer-events: none; opacity: 0; transition: opacity .25s; }
#journal-hint { position: fixed; right: 8px; bottom: 8px; color: #ccc; font: 12px monospace; text-shadow: 0 0 2px #000; }
#journal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(560px, 92vw);
  max-height: 82vh; overflow: auto; padding: 18px 22px; box-sizing: border-box; display: none;
  background: #e9dcb8; color: #2b2116; font: 13px/1.45 monospace; border: 3px solid #5a4528;
  box-shadow: 0 0 0 4px #2b2116, 0 10px 40px #000c; }
#journal.open { display: block; }
#journal h2 { margin: 0 0 4px; font-size: 18px; letter-spacing: 2px; }
#journal .sub { margin: 0 0 12px; color: #6b5838; }
#journal .verdict { padding: 8px 10px; margin-bottom: 12px; border: 2px dashed #8a7048; background: #f3e9cf; }
#journal .verdict b { font-size: 15px; }
#journal .bar { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
#journal .bar span:first-child { width: 92px; }
#journal .bar .track { flex: 1; height: 8px; background: #d4c49c; }
#journal .bar .fill { height: 100%; background: #6b3f1f; }
#journal ol { margin: 0; padding-left: 22px; }
#journal li { margin-bottom: 6px; }
#journal li .type { font-weight: bold; }
#journal li .age { color: #6b5838; }
#journal .empty { color: #6b5838; font-style: italic; }
#journal .foot { margin-top: 12px; color: #6b5838; font-size: 11px; }
`;

// Field journal overlay (J), examine prompt under the crosshair, and a "logged" toast.
export class JournalUI {
  constructor(journal, finder) {
    this.journal = journal;
    this.finder = finder;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    this.prompt = el('div', 'examine-prompt');
    this.toast = el('div', 'journal-toast');
    this.hint = el('div', 'journal-hint');
    this.panel = el('div', 'journal');
    document.body.append(this.prompt, this.toast, this.hint, this.panel);

    this.open = false;
    this.refreshTimer = 0;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && !e.repeat) this.setOpen(!this.open);
    });
    journal.on((ev, entry) => {
      if (ev !== 'record') return;
      const n = journal.entries.length;
      const v = journal.verdict();
      this.showToast(`${entry.label} logged in journal (${n})` + (v.ready && n === CLUES_FOR_VERDICT ? `: looks like ${v.likely.name}` : ''));
      this.render();
    });
    this.render();
  }

  setOpen(open) {
    this.open = open;
    this.panel.classList.toggle('open', open);
    if (open) this.render();
  }

  showToast(text) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast.style.opacity = '0'; }, 2200);
  }

  update(dt) {
    const t = this.finder.target;
    this.prompt.style.display = t && !this.open ? 'block' : 'none';
    if (t) this.prompt.textContent = `[E] Examine ${({ scratch: 'scratch marks', hair: 'hair', footprint: 'footprint', branch: 'snapped branch', scat: 'droppings', deerTrack: 'hoof prints', foxTrack: 'paw prints', owlFeather: 'feather', wingDust: 'dusty scales', shoreTrace: 'flattened reeds' })[t.type] ?? t.type}`;
    this.hint.textContent = `[J] Journal (${this.journal.entries.length})`;
    // Ages tick while the journal is open.
    if (this.open && (this.refreshTimer -= dt) <= 0) { this.refreshTimer = 1; this.render(); }
  }

  render() {
    const j = this.journal;
    const v = j.verdict();
    let verdict;
    if (!j.entries.length) {
      verdict = `<b>No evidence yet.</b><br>Find tracks with your flashlight, aim at one and press E to examine it.`;
    } else if (!v.ready) {
      verdict = `<b>Not enough evidence.</b> ${v.needed} more clue${v.needed > 1 ? 's' : ''} needed for an identification.`;
    } else {
      verdict = `Likely cryptid: <b>${v.likely.name}</b>, ${confidenceWord(v.likely.confidence)} confidence (${pct(v.likely.confidence)})` +
        v.ranking.map((r) => `<div class="bar"><span>${r.name}</span><div class="track"><div class="fill" style="width:${pct(r.confidence)}"></div></div><span>${pct(r.confidence)}</span></div>`).join('');
    }
    const items = j.entries.slice().reverse().map((e) =>
      `<li><span class="type">${e.label}</span>: ${e.description}${e.hint ? `<br><i>${e.hint}</i>` : ''}<br><span class="age">${formatAge(j.ageOf(e))} · logged ${formatAge(j.time - e.foundAt).replace(' old', ' ago')}</span></li>`).join('');
    this.panel.innerHTML = `<h2>FIELD JOURNAL</h2><p class="sub">Pine Hollow · ${j.entries.length} clue${j.entries.length === 1 ? '' : 's'} logged</p>
      <div class="verdict">${verdict}</div>
      ${this.dossier ? `<div class="dossier" style="margin:-4px 0 12px;padding:6px 10px;border:1px solid #8a7048;background:#efe3c4">${this.dossier()}</div>` : ''}
      ${items ? `<ol reversed>${items}</ol>` : '<p class="empty">No clues logged.</p>'}
      <p class="foot">Age = time since the cryptid left it. Fresh clues mean it's close. [J] close</p>`;
  }
}

function el(tag, id) { const e = document.createElement(tag); e.id = id; return e; }
function pct(p) { return `${Math.round(p * 100)}%`; }

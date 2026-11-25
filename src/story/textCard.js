import { STORY_CARDS } from './cardText.js';

// Reusable full-screen text card: title, body paragraphs, "press any key to continue".
// show(id) resolves when the player dismisses it (any key or click, after a short delay so a
// held key can't skip it).
export class TextCard {
  constructor(cards = STORY_CARDS) {
    this.cards = cards;
    this.open = null;
    const el = this.el = document.createElement('div');
    el.id = 'text-card';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '18px', padding: '0 16px', background: 'rgba(5,7,12,0.96)', color: '#d8d2c4', fontFamily: 'monospace',
      textAlign: 'center', zIndex: '40', cursor: 'pointer',
    });
    this.title = document.createElement('div');
    Object.assign(this.title.style, { fontSize: '34px', letterSpacing: '8px', color: '#f0952c' });
    this.kicker = document.createElement('div');
    Object.assign(this.kicker.style, { fontSize: '11px', color: '#6a83a0', letterSpacing: '2px', textTransform: 'uppercase' });
    this.body = document.createElement('div');
    Object.assign(this.body.style, { maxWidth: '620px', fontSize: '15px', lineHeight: '1.7' });
    this.hint = Object.assign(document.createElement('div'), { textContent: 'press any key to continue' });
    Object.assign(this.hint.style, { fontSize: '12px', color: '#8c8e88', marginTop: '14px' });
    el.append(this.title, this.kicker, this.body, this.hint);
    document.body.appendChild(el);
    const dismiss = (e) => {
      if (!this.open || performance.now() < this.readyAt) return;
      e.preventDefault(); e.stopPropagation();
      this.close();
    };
    addEventListener('keydown', dismiss, true);
    el.addEventListener('click', dismiss);
  }

  show(id) {
    const c = this.cards[id];
    if (!c) return Promise.resolve();
    this.title.textContent = c.title;
    this.kicker.textContent = c.kicker ?? '';
    this.body.replaceChildren(...c.body.map((p) => { const d = document.createElement('p'); d.textContent = p; d.style.margin = '0 0 10px'; return d; }));
    this.el.style.display = 'flex';
    document.exitPointerLock?.();
    this.readyAt = performance.now() + 500;
    return new Promise((resolve) => { this.open = { id, resolve }; });
  }

  close() {
    const o = this.open;
    this.open = null;
    this.el.style.display = 'none';
    o?.resolve();
  }
}

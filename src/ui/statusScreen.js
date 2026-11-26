// Status screen (GDD 2.11, 13.1): Tab opens it. Lists your attributes, every active condition with
// its root cause, what it is doing to you and what to do about it, and what you can currently do.
// Opening it pauses the hunt (menus pause solo play). Words carry the meaning; colour only helps.

export class StatusScreen {
  constructor({ model, input }) {
    this.model = model;
    this.open = false;
    const css = document.createElement('style');
    css.textContent = `
#status-screen { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 40;
  background: #05070cc0; font: 13px/1.5 monospace; color: #e8e2d0; }
#status-screen.open { display: flex; }
#status-screen .panel { width: min(720px, 94vw); max-height: 88vh; overflow: auto; padding: 16px 20px; box-sizing: border-box;
  background: #14120fe8; border: 2px solid #6b5838; box-shadow: 0 0 0 3px #0a0908; }
#status-screen h2 { margin: 0 0 2px; font-size: 16px; letter-spacing: 3px; }
#status-screen .sub { color: #a89a7a; margin-bottom: 12px; }
#status-screen h3 { margin: 12px 0 6px; font-size: 12px; letter-spacing: 2px; color: #c8a86a; }
#status-screen .attr { display: grid; grid-template-columns: 140px 160px 1fr; gap: 8px; align-items: center; margin: 3px 0; }
#status-screen .track { height: 9px; background: #000a; border: 1px solid #7a6a50; }
#status-screen .fill { height: 100%; background: #c8b48a; }
#status-screen .cond { margin: 6px 0; padding: 6px 8px; border-left: 4px solid #7a6a50; background: #1e1a14; }
#status-screen .cond .head { font-weight: bold; }
#status-screen .cond .tag { display: inline-block; min-width: 46px; padding: 0 4px; margin-right: 6px; border: 1px solid; font-size: 11px; text-align: center; }
#status-screen .cond.s2 { border-left-color: #d0604d; } #status-screen .cond.s1 { border-left-color: #e0a040; }
#status-screen .cond div.line { color: #cfc6b0; } #status-screen .cond div.line b { color: #e8e2d0; font-weight: normal; }
#status-screen .none { color: #a89a7a; font-style: italic; }
#status-screen .foot { margin-top: 12px; color: #8a7e66; font-size: 11px; }`;
    document.head.append(css);
    this.el = Object.assign(document.createElement('div'), { id: 'status-screen' });
    this.el.innerHTML = '<div class="panel"></div>';
    document.body.append(this.el);
    addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      if (e.repeat) return;
      if (input.locked || this.open) this.toggle();
    });
  }

  toggle(want = !this.open) {
    this.open = want;
    this.el.classList.toggle('open', want);
    if (want) this.render();
  }

  render() {
    const m = this.model;
    const attrs = m.attributes().map((a) => `<div class="attr"><span>${a.name}</span>
      <div class="track"><div class="fill" style="width:${Math.round(Math.max(0, Math.min(1, a.value)) * 100)}%"></div></div><span>${a.text}</span></div>`).join('');
    const conds = m.conditions();
    const condHtml = conds.length ? conds.map((c) => `<div class="cond s${c.severity}">
      <div class="head"><span class="tag">${c.stage === 'soon' ? 'SOON' : 'NOW'}</span>${c.name} <span style="color:#a89a7a">(${c.severityName})</span></div>
      <div class="line">Cause: <b>${c.cause}</b></div>
      <div class="line">${c.stage === 'soon' ? 'Coming' : 'Effect'}: <b>${c.effect}</b></div>
      <div class="line">What to do: <b>${c.fix}</b></div></div>`).join('') : '<div class="none">Nothing wrong. You are fed, warm, dry and steady.</div>';
    this.el.querySelector('.panel').innerHTML = `<h2>STATUS</h2><div class="sub">Hunt paused while this is open · Tab to close</div>
      <h3>BODY AND GEAR</h3>${attrs}
      <h3>CONDITIONS</h3>${condHtml}
      <h3>WHAT YOU CAN DO NOW</h3>${m.capability().map((l) => `<div>${l}</div>`).join('')}
      <div class="foot">SOON = a warning before it affects you. NOW = it is affecting you.</div>`;
  }
}

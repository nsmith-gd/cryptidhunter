import { DURABLES, REPAIR_KIT } from './condition.js';
import { formatCAD, cents } from '../economy/ledger.js';

// EQUIPMENT panel at base camp (#106): each durable item's condition, what it does to the item
// right now, its resale value, and the HQ repair price (one charge to the ledger). Drying out is
// free. A field repair kit (5 uses) can be bought here for the field.

const EFFECT = {
  camera: (c) => (c < 0.995 ? `night photos ${Math.round((1 - 0.5 * (1 - c)) * 100)}% as clear` : 'clear night photos'),
  flashlight: (c) => (c < 0.995 ? `beam ${Math.round((0.55 + 0.45 * c) * 100)}% strength${c < 0.25 ? ', flickers' : ''}` : 'full beam'),
  shoes: (c) => (Math.round((1 - (0.85 + 0.15 * c)) * 100) >= 1 ? `wading ${Math.round((1 - (0.85 + 0.15 * c)) * 100)}% slower` : 'sound soles'),
};

export function showEquipmentPanel(equipment, { canAct = () => true, onChange = () => {}, root = document.querySelector('#overlay > div') } = {}) {
  if (!root) return null;
  const el = document.createElement('div');
  el.id = 'equipment-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '8px 12px', border: '1px solid #556', background: '#10141bcc',
    textAlign: 'left', font: '12px/1.6 monospace', color: '#ddd', cursor: 'default' });
  let note = '';
  const camp = equipment.camp;
  const render = () => {
    const kitUses = camp.state.gear?.repairKit ?? 0;
    el.innerHTML = `<div>EQUIPMENT · condition, resale and HQ repair (35% of list per 100% restored) · cash ${formatCAD(camp.ledger.cash)}</div>` +
      Object.keys(DURABLES).map((k) => {
        const q = equipment.quote(k), pct = Math.round(q.condition * 100);
        const bar = '█'.repeat(Math.round(q.condition * 10)).padEnd(10, '·');
        const col = pct >= 75 ? '#9fd08a' : pct >= 40 ? '#ffd88a' : '#ff8a7a';
        return `<div data-item="${k}"><span style="display:inline-block;width:170px">${DURABLES[k].name}</span>` +
          `<span style="color:${col}">${bar} ${String(pct).padStart(3)}%</span>${equipment.wet[k] ? ' <span style="color:#8ab8ff">wet (dries free)</span>' : ''}` +
          ` · <span style="color:#aaa">${EFFECT[k](q.condition)}</span> · resale ${formatCAD(q.resaleCents)}` +
          (q.repairCents >= 100 ? ` <button data-repair="${k}" style="font:11px monospace;cursor:pointer">Repair ${formatCAD(q.repairCents)}</button>` : '') + '</div>';
      }).join('') +
      `<div style="margin-top:4px">Field repair kit: ${kitUses} use${kitUses === 1 ? '' : 's'} owned ` +
      `<button data-buykit="1" style="font:11px monospace;cursor:pointer">Buy kit ${formatCAD(cents(REPAIR_KIT.price))} (5 uses)</button>` +
      ` <span style="color:#888">slot it and press Q in the field: +25% to your worst item, up to 75%</span></div>` +
      (note ? `<div style="color:#ffd88a">${note}</div>` : '');
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();                      // don't start the hunt
    const b = e.target.closest('button');
    if (!b) return;
    if (!canAct()) { note = 'Repairs and purchases happen at base camp, before you set off.'; render(); return; }
    if (b.dataset.repair) {
      const k = b.dataset.repair, q = equipment.quote(k);
      const r = equipment.repair(k);
      note = r.ok ? `Repaired the ${DURABLES[k].name.toLowerCase()} for ${formatCAD(r.cents)}.` : `Can't repair: ${r.reason}`;
      void q;
    }
    if (b.dataset.buykit) {
      const r = camp.ledger.purchase(camp.ledger.nextId('buy:D10'), cents(REPAIR_KIT.price), REPAIR_KIT.name);
      if (r.ok) { camp.state.gear.repairKit = (camp.state.gear.repairKit ?? 0) + REPAIR_KIT.uses; camp.save(); note = 'Bought a field repair kit (5 uses).'; }
      else note = `Can't buy: ${r.reason}`;
    }
    render();
    onChange();
  });
  render();
  const after = root.querySelector('#camp-panel');
  if (after) after.after(el); else root.append(el);
  return { el, render };
}

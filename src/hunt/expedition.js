// Expedition lifecycle (#98; GDD 6.1, 6.3, 6.4, 7.5, 13.1):
//   Plan      the prep panel on the start screen: trip cost, owned stock, carried mass, cash after
//             commit, deposits, and recommended vs required capabilities. Nothing is charged yet.
//   Commit    one explicit button: the trip cost is debited once under a new attempt ID (ledger,
//             #97) and the attempt is saved. Starting the hunt any other way (gamepad A, tests)
//             commits the same way; committing twice charges nothing.
//   Investigate / Extract  in the field; at the van, H opens the extraction manifest review
//             (carried evidence, items left behind, irreversible-departure warning), H again drives out.
//             Emergency evacuation is offered from the pause screen (stated fee, collected up to cash).
//   Debrief   the results screen: outcome class, gross revenue, bonus, expenses, losses, closing cash.

import { ECONOMY, formatCAD } from '../economy/ledger.js';
import { gearList } from './camp.js';

export const EXPEDITION = Object.freeze({
  tripCents: ECONOMY.tripCostCents.L01,   // $25 operating envelope (travel + standard supplies)
  emergencyCents: 4000,                   // $40 emergency evacuation (ranger pickup from where you are)
});

/** Outcome classes (GDD 6.4). */
export const OUTCOMES = Object.freeze({
  successful: 'Successful documented extraction',
  partial: 'Partial extraction',
  empty: 'Empty extraction',
  emergency: 'Emergency extraction',
  'failed-capture': 'Failed capture, successful withdrawal',
  missing: 'Did not make it out',
});

/**
 * Classify a finished attempt. huntOutcome: complete | abandoned | emergency | caught | dawn.
 * targetPhoto: a photo of the target came home. evidence: number of extracted evidence items,
 * photos: number of photos sold. capture: { attempted, delivered } (live capture is a later-level
 * mechanic; at L01 it never happens, so this class can't occur in Pine Hollow yet).
 */
export function classifyOutcome({ huntOutcome, targetPhoto = false, evidence = 0, photos = 0, capture = null }) {
  if (huntOutcome === 'caught' || huntOutcome === 'dawn') return 'missing';
  if (huntOutcome === 'emergency') return 'emergency';
  if (capture?.attempted && !capture.delivered) return 'failed-capture';
  if (targetPhoto) return 'successful';
  if (evidence > 0 || photos > 0) return 'partial';
  return 'empty';
}

export class Expedition {
  /**
   * camp: Camp (ledger + save). loadout: Loadout (carried mass). mapName/target for the header.
   * capabilities(): [{ name, required, ok, note }]
   */
  constructor({ camp, loadout, mapName, target, capabilities = () => [], tripCents = EXPEDITION.tripCents }) {
    this.camp = camp;
    this.loadout = loadout;
    this.mapName = mapName;
    this.target = target;
    this.capabilities = capabilities;
    this.tripCents = tripCents;
    this.attemptId = null;
    this.state = 'plan';          // plan | committed | settled
    this.closeAbandonedAttempt();
  }

  get committed() { return this.state !== 'plan'; }

  /**
   * An attempt committed in an earlier session that was never driven out of (the page was closed
   * mid-hunt): settle it once as unextracted, so nothing carried pays out and it can't be reused.
   */
  closeAbandonedAttempt() {
    const id = this.camp.state.activeAttempt;
    if (!id) return;
    if (this.camp.ledger.attempts[id]?.state !== 'settled') this.camp.ledger.settleAttempt(id, { extracted: false });
    this.camp.state.activeAttempt = null;
    this.camp.save();
  }

  /** Plan numbers shown on the prep panel. */
  plan() {
    const cash = this.camp.ledger.cash, load = this.loadout?.load;
    const affordable = cash >= this.tripCents;
    return {
      tripCents: this.tripCents, cash, after: affordable ? cash - this.tripCents : cash,
      affordable, deposits: this.camp.ledger.reservedCents,
      stock: gearList(this.camp.state.gear),
      kg: load ? +load.total.toFixed(1) : null, ratio: load ? Math.round(load.ratio * 100) : null,
      capabilities: this.capabilities(),
    };
  }

  /**
   * Commit: debit the trip once, create the attempt ID, save. If cash can't cover the trip, the
   * local recovery sponsor (GDD 7.4) waives it rather than blocking a viable L01 outing.
   */
  commit() {
    if (this.committed) return { ok: true, duplicate: true, attemptId: this.attemptId };
    const id = this.camp.newAttemptId();
    const waive = this.camp.ledger.cash < this.tripCents;
    // #105: when a sponsor survey is on offer, a broke player takes that instead of a free trip.
    if (waive && this.requireSponsor?.()) return { ok: false, reason: 'You can\'t afford this trip: take the sponsor\'s survey' };
    const r = this.camp.ledger.commitAttempt(id, this.tripCents, { waive });
    if (!r.ok) return r;
    this.attemptId = id;
    this.waived = waive;
    this.state = 'committed';
    this.camp.state.activeAttempt = id;
    this.camp.save();
    this.render();
    return { ok: true, attemptId: id, charged: waive ? 0 : this.tripCents };
  }

  /** Called once the attempt has been settled by base camp. */
  settled() {
    this.state = 'settled';
    this.camp.state.activeAttempt = null;
    this.camp.save();
  }

  // ---- prep panel ---------------------------------------------------------------------------
  mount(root = document.querySelector('#overlay > div'), { onCommit = () => {}, onEmergency = null } = {}) {
    if (!root) return null;
    const el = this.el = document.createElement('div');
    el.id = 'prep-panel';
    Object.assign(el.style, { margin: '0 auto 16px', padding: '10px 14px', border: '1px solid #c8a86a', background: '#1e1a12e6',
      color: '#f1e6c8', textAlign: 'left', font: '13px/1.55 monospace' });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      e.stopPropagation();               // clicking the plan never starts the hunt by itself
      if (!b) { this.nudge(); return; }
      if (b.dataset.act === 'commit') { const r = this.commit(); if (r.ok) onCommit(r); }
      if (b.dataset.act === 'resume') onCommit({ ok: true, resumed: true });
      if (b.dataset.act === 'emergency' && onEmergency) { if (this.armedEmergency) { this.armedEmergency = false; onEmergency(); } else { this.armedEmergency = true; this.render(); } }
    });
    this.onEmergency = onEmergency;
    root.prepend(el);
    this.render();
    return el;
  }

  /** Flash the panel when someone clicks the start screen without committing. */
  nudge() {
    if (!this.el || this.committed) return;
    this.el.style.borderColor = '#ffd88a';
    this.el.querySelector('[data-act="commit"]')?.animate?.([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 400);
    this.hint = 'Review the plan, then press COMMIT to pay for the trip and set off.';
    this.render();
  }

  render() {
    if (!this.el) return;
    const p = this.plan();
    const tick = (c) => (c.ok ? '✓' : c.required ? '✗' : '○');
    const caps = (req) => p.capabilities.filter((c) => !!c.required === req)
      .map((c) => `<div style="color:${c.ok ? '#bfe3a8' : c.required ? '#ff9c7a' : '#c8b88a'}">  ${tick(c)} ${c.name}${c.note ? ` <span style="color:#8f8468">· ${c.note}</span>` : ''}</div>`).join('');
    const row = (k, v) => `<div><span style="display:inline-block;width:230px;color:#c8a86a">${k}</span>${v}</div>`;
    const btn = (act, label, bg = '#ffd88a') => `<button data-act="${act}" style="margin-top:8px;font:bold 13px monospace;padding:5px 12px;cursor:pointer;background:${bg};color:#1a140c;border:1px solid #7a6440">${label}</button>`;
    if (this.state === 'plan') {
      this.el.innerHTML = `<div style="font-weight:bold;letter-spacing:1px">EXPEDITION PREP · ${this.mapName} · target: ${this.target}</div>
        ${row('Trip cost', `${formatCAD(p.tripCents)} <span style="color:#8f8468">· fuel, access, standard supplies</span>`)}
        ${row('Cash now → after commit', `${formatCAD(p.cash)} → ${formatCAD(p.after)}${p.affordable ? '' : this.requireSponsor?.() ? ' (not enough: see the sponsor survey)' : ' (waived: sponsor survey)'}`)}
        ${row('Deposits held', p.deposits ? formatCAD(p.deposits) : '$0 (no rentals on this trip)')}
        ${row('Carrying', p.kg == null ? '-' : `${p.kg} kg · ${p.ratio}% of a full load`)}
        ${row('Owned stock at camp', p.stock || 'nothing')}
        <div style="color:#c8a86a;margin-top:4px">Required to go</div>${caps(true)}
        <div style="color:#c8a86a">Recommended</div>${caps(false)}
        ${!p.affordable && this.requireSponsor?.() ? '<div style="color:#ffb070;margin-top:8px">Not enough cash for this trip. Take the sponsor\'s survey above to earn some.</div>'
          : btn('commit', `COMMIT · pay ${p.affordable ? formatCAD(p.tripCents) : '$0'} and drive to the trailhead`)}
        <div style="color:#8f8468;font-size:12px">Nothing is charged until you commit. Pack and shop below first.</div>
        ${this.hint ? `<div style="color:#ffd88a">${this.hint}</div>` : ''}`;
    } else if (this.state === 'committed') {
      this.el.innerHTML = `<div style="font-weight:bold;letter-spacing:1px">EXPEDITION UNDER WAY · ${this.mapName} · attempt ${this.attemptId}</div>
        ${row('Trip cost paid', this.waived ? '$0 (waived: sponsor survey)' : formatCAD(this.tripCents))}
        ${row('Cash', formatCAD(p.cash))}
        <div style="color:#8f8468">To leave normally, walk back to the van and press H there.</div>
        ${btn('resume', 'BACK TO THE FIELD')}
        ${this.onEmergency ? btn('emergency', this.armedEmergency ? `CONFIRM: call the evacuation (${formatCAD(EXPEDITION.emergencyCents)}, final)` : `Emergency evacuation · ${formatCAD(EXPEDITION.emergencyCents)}`, '#e7a08a') : ''}
        ${this.onEmergency ? '<div style="color:#8f8468;font-size:12px">A ranger picks you up where you stand. What you carry comes with you; anything you set out in the woods stays there.</div>' : ''}`;
    } else this.el.innerHTML = `<div>Expedition ${this.attemptId} settled.</div>`;
  }
}

/** Extraction manifest (GDD 6.3) shown at the van before the irreversible departure. */
export function manifestText({ evidence = [], photos = 0, targetPhotos = 0, target, leftBehind = [], kg = null, estimate = null }) {
  const lines = ['EXTRACTION · the van at the trailhead parking', ''];
  lines.push('LOADING');
  lines.push(`  Photos on your camera: ${photos}${targetPhotos ? ` (${targetPhotos} of ${target})` : ''}`);
  if (evidence.length) for (const e of evidence) lines.push(`  ${e}`);
  else lines.push('  No physical evidence collected');
  if (kg != null) lines.push(`  Carried: ${kg} kg`);
  lines.push('', 'LEFT BEHIND');
  if (leftBehind.length) for (const l of leftBehind) lines.push(`  ${l}`);
  else lines.push('  Nothing: everything you brought is with you');
  if (estimate) lines.push('', `Evidence estimate: ${estimate} (not a guaranteed payout)`);
  lines.push('', 'Driving away is final: anything left out here is gone.', '[H] Drive out      [C] Keep investigating');
  return lines.join('\n');
}

import { cryptidName } from './bounties.js';

// BOUNTY BOARD panel on the base-camp (start) screen (#45). Placeholder styling: a pinned-paper
// list of the active offers (target, minimum score, bonus) and the ones already claimed.
export function bountyLines(board) {
  const { active, completed } = board.listing();
  const lines = ['BOUNTY BOARD  ·  sell a photo that meets an offer and the bonus is paid once'];
  if (!active.length) lines.push('  All bounties claimed. More soon.');
  for (const b of active) lines.push(`  [ ] ${cryptidName(b.cryptid)} photo, score ${b.minScore}+  ·  bonus $${b.bonus}  ·  ${b.title}`);
  for (const b of completed) lines.push(`  [x] ${cryptidName(b.cryptid)} photo, score ${b.minScore}+  ·  $${b.bonus}  ·  CLAIMED`);
  return lines;
}

export function showBountyPanel(board, root = document.querySelector('#overlay > div')) {
  if (!root || !board) return null;
  const el = document.createElement('div');
  el.id = 'bounty-panel';
  Object.assign(el.style, { margin: '0 auto 16px', padding: '10px 14px', border: '1px dashed #a08a5c', background: '#3a2f1ecc',
    color: '#f1e6c8', textAlign: 'left', whiteSpace: 'pre-wrap', font: '13px/1.5 monospace' });
  el.textContent = bountyLines(board).join('\n');
  const place = () => { const camp = root.querySelector('#camp-panel'); if (camp) camp.after(el); else root.prepend(el); };
  place();
  // Other camp panels (loadout, shop, map) mount later: keep the board right under the camp summary.
  setTimeout(place, 0);
  return el;
}

// Photo album (L1): every shot on this hunt's roll as a thumbnail, shown at the end of the hunt.
// Each card shows the frame number, HIT/MISS and score; the best one is starred. If the hunt's
// photos were lost (caught, or still in the woods at dawn), the album is stamped LOST.

const CSS = `
.album { margin-top: 14px; text-align: left; white-space: normal; }
.album h3 { margin: 0 0 6px; font: bold 13px monospace; letter-spacing: 2px; color: #ddd; }
.album .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 8px; max-width: 760px; }
.album .card { position: relative; background: #e9dcb8; padding: 4px 4px 2px; box-shadow: 0 2px 6px #0008; color: #2b2116; font: 11px monospace; }
.album .card img { display: block; width: 100%; image-rendering: pixelated; background: #111; aspect-ratio: 16 / 9; }
.album .card .cap { display: flex; justify-content: space-between; padding-top: 2px; }
.album .card.miss { opacity: .7; }
.album .card.best { outline: 2px solid #ffd88a; }
.album.lost .card img { filter: grayscale(1) brightness(.5); }
.album .stamp { display: inline-block; margin-left: 8px; padding: 0 6px; border: 2px solid #ff6a5a; color: #ff6a5a; transform: rotate(-4deg); }
.album .empty { color: #999; font: 12px monospace; }`;

let styled = false;

/** entries: the camera log ({ frame, result, subject, score, thumb }). Returns an element. */
export function renderAlbum(entries, { filmTotal, lost = false, target = null } = {}) {
  if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); styled = true; }
  const el = document.createElement('div');
  el.className = `album${lost ? ' lost' : ''}`;
  el.id = 'photo-album';
  const best = entries.filter((e) => e.result === 'HIT' && (!target || e.subject === target))
    .reduce((b, e) => (!b || e.score > b.score ? e : b), null);
  el.innerHTML = `<h3>PHOTO ALBUM · ${entries.length}/${filmTotal ?? entries.length} frames${lost ? '<span class="stamp">LOST</span>' : ''}</h3>`;
  if (!entries.length) {
    el.insertAdjacentHTML('beforeend', '<div class="empty">No photos taken this hunt.</div>');
    return el;
  }
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const e of entries) {
    const card = document.createElement('div');
    card.className = `card ${e.result === 'HIT' ? 'hit' : 'miss'}${e === best ? ' best' : ''}`;
    const img = document.createElement('img');
    if (e.thumb) img.src = e.thumb;
    img.alt = e.subject ? `${e.subject}, score ${e.score}` : 'empty frame';
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.innerHTML = `<span>#${e.frame ?? '?'} ${e === best ? '★ ' : ''}${e.subject ?? 'nothing'}</span><span>${e.result === 'HIT' ? e.score : 'miss'}</span>`;
    card.append(img, cap);
    grid.append(card);
  }
  el.append(grid);
  return el;
}

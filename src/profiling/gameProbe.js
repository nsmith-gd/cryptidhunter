// Read-only probes that feed the profiling recorder from the running game (GDD 17.1: instrument
// through domain events, never write game state). Each probe wraps an existing callback/method,
// calls the original unchanged, then reports what happened.
export function attachProbes(rec, g) {
  const wrap = (obj, name, after) => {
    const orig = obj?.[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...args) {
      const r = orig.apply(this, args);
      try { after(r, args); } catch { /* a probe must never break the game */ }
      return r;
    };
  };
  let huntN = 0;
  const corr = () => `hunt-${huntN}`;
  const photoData = (p, fallback) => ({ subject: p?.subject ?? null, score: p?.score ?? 0,
    distance_m: Number.isFinite(p?.distance) ? +p.distance.toFixed(2) : null, source: p?.source ?? fallback });

  // Evidence (P07): every camera shot (hit or miss) and every clue logged in the journal.
  wrap(g.photo, 'onPhoto', (_, [p]) => rec.event('photo_taken', { system_id: 'P07', correlation_id: corr(), data: photoData(p, 'handheld camera') }));
  wrap(g.trailCams, 'onPhoto', (_, [p]) => rec.event('photo_taken', { system_id: 'P07', correlation_id: corr(), data: photoData(p, 'trail camera') }));
  g.journal?.on?.((ev, entry) => {
    if (ev === 'record') rec.event('clue_logged', { system_id: 'P07', correlation_id: corr(), data: { type: entry.type, clue_id: entry.clueId } });
  });

  // Session: hunt start / end.
  wrap(g.hunt, 'start', () => { huntN++; rec.event('hunt_started', { system_id: 'X08', correlation_id: corr(), data: { target: g.hunt.target ?? null } }); });
  wrap(g.hunt, 'end', (_, [outcome]) => rec.event('hunt_ended', { system_id: 'X08', correlation_id: corr(), data: { outcome } }));

  // Economy (P08): the sale at the end of a hunt (with any bounties), and purchases at camp
  // (seen as money going down when camp saves).
  let lastMoney = g.camp?.state?.money ?? 0;
  wrap(g.camp, 'settleHunt', (h) => {
    if (h) {
      rec.event('evidence_sold', { system_id: 'P08', correlation_id: corr(),
        data: { outcome: h.outcome, earned: h.earned ?? 0, photos_sold: h.sold?.length ?? 0, photos_lost: h.photosLost ?? 0, money_after: h.moneyAfter ?? null } });
      for (const b of h.bounties ?? []) rec.event('bounty_paid', { system_id: 'P08', correlation_id: corr(), data: { id: b.id, bonus: b.bonus, score: b.score } });
    }
    lastMoney = g.camp.state.money;
  });
  wrap(g.camp, 'save', () => {
    const m = g.camp.state.money;
    if (m < lastMoney) rec.event('purchase', { system_id: 'P08', data: { cost: lastMoney - m, money_after: m } });
    lastMoney = m;
  });

  // Pauses become non-gameplay segments (excluded from frame statistics).
  if (g.pauseState) {
    const prev = g.pauseState.onChange;
    g.pauseState.onChange = (p) => { prev?.(p); rec.setSegment(p.paused ? 'paused' : 'active', p.paused ? p.text : null); };
  }
}

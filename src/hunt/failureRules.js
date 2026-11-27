// Field failure rules (#89; GDD 9.1 outcome table, 9.3 between-expedition recovery). Headless.
//
// Ordinary death (health 0 from a creature, an untreated wound or critical cold):
//   lost      everything carried, deployed or staged in the field (quick slots, pack, trail cameras
//             and lures still set out, durable gear you had on you, rented gear: deposit forfeited),
//             consumables, unextracted evidence and photos, and this trip's field notes
//   persists  HQ stock (gear left at camp), banked cash, the evidence archive and dossiers,
//             unlocked places. No extra medical charge for a death. The next trip is a fresh attempt.
// Extraction with injuries: health returns to normal off-screen between trips, but a moderate or
// severe injury costs a visible recovery charge of 5% or 10% of the trip's operating envelope,
// capped at the cash you have after settlement (GDD 9.3).

export const RECOVERY = Object.freeze({
  moderateBelow: 70,       // health below this (or any wound) at extraction: moderate injury
  severeBelow: 40,         // health below this (or a heavy bleed still open): severe
  moderateRate: 0.05,
  severeRate: 0.10,
});

/** How badly hurt you came home. health: survival/health.js Health. */
export function injurySeverity(health) {
  const open = health.conditions.filter((c) => c.kind === 'bleeding');
  const wounds = health.conditions.filter((c) => c.kind === 'bleeding' || c.kind === 'dressed');
  if (health.value < RECOVERY.severeBelow || open.some((c) => c.severity === 'heavy')) return 'severe';
  if (health.value < RECOVERY.moderateBelow || wounds.length) return 'moderate';
  return 'none';
}

/**
 * Charge the recovery cost once per attempt (capped at cash; the rest is waived, no debt).
 * Returns { severity, cents, quoted } or null when no charge applies.
 */
export function chargeRecovery(ledger, health, tripCents, attemptId) {
  const severity = injurySeverity(health);
  if (severity === 'none') return null;
  const quoted = Math.round(tripCents * (severity === 'severe' ? RECOVERY.severeRate : RECOVERY.moderateRate));
  const take = Math.min(quoted, ledger.cash);
  const r = ledger.post(`recovery:${attemptId ?? ledger.nextId('recovery-anon')}`, 'charge', -take, { memo: `Injury recovery (${severity})` });
  return { severity, quoted, cents: r.duplicate ? -r.tx.cents : take };
}

/** The gear counts camp keeps after the hunt: carried counts, or all zero after a death. */
export function gearAfter(carried, died) {
  return died ? Object.fromEntries(Object.keys(carried).map((k) => [k, 0])) : carried;
}

/** Player-facing lines for the death screen: exactly what was lost and what persists. */
export function deathReport({ carried = [], deployed = [], durable = [], rentals = [], evidence = 0, photos = 0, notes = 0 }) {
  const lost = [
    ...(carried.length ? [`Carried gear: ${carried.join(', ')}`] : []),
    ...(deployed.length ? [`Set out in the woods: ${deployed.join(', ')}`] : []),
    ...(durable.length ? [`Your own gear: ${durable.join(', ')}`] : []),
    ...(rentals.length ? [`Rented gear: ${rentals.join(', ')} (deposit kept)`] : []),
    ...(evidence ? [`${evidence} piece${evidence > 1 ? 's' : ''} of evidence`] : []),
    ...(photos ? [`${photos} photo${photos > 1 ? 's' : ''} on the roll`] : []),
    ...(notes ? [`${notes} field note${notes > 1 ? 's' : ''} from tonight`] : []),
  ];
  const kept = ['Gear you left at base camp', 'Your banked money', 'Your evidence archive and research dossiers', 'Places you have unlocked'];
  return { lost, kept, text: `LOST:\n${lost.length ? lost.map((l) => `  - ${l}`).join('\n') : '  - nothing of value'}\nKEPT:\n${kept.map((l) => `  - ${l}`).join('\n')}\nNo medical bill for a death. Your next trip is a fresh attempt.` };
}

// Reputation stub (until the hub-economy reputation system, #45/#46, lands).
// The real system should replace this object with the same shape: value, max, set(), add(), onChange().
export const REPUTATION_MAX = 100;

export class ReputationStub {
  constructor(value = 0, max = REPUTATION_MAX) {
    this.value = value;
    this.max = max;
    this.listeners = [];
  }
  set(v) {
    this.value = Math.max(0, Math.min(this.max, Math.round(v)));
    for (const fn of this.listeners) fn(this.value, this.max);
  }
  add(d) { this.set(this.value + d); }
  onChange(fn) { this.listeners.push(fn); }
}

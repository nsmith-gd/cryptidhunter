// Player money and hunt count, kept between hunts (and page reloads) in browser storage.
// L0 stand-in for the save/progression system.
const KEY = 'cryptidhunter.wallet.v1';

export class Wallet {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    const saved = this.read();
    this.money = saved.money ?? 0;
    this.hunts = saved.hunts ?? 0;
    this.lastEarned = saved.lastEarned ?? 0;
  }

  read() {
    try { return JSON.parse(this.storage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
  }

  save() {
    try { this.storage?.setItem(KEY, JSON.stringify({ money: this.money, hunts: this.hunts, lastEarned: this.lastEarned })); } catch { /* private mode etc. */ }
  }

  /** Bank a finished hunt's earnings. */
  deposit(amount) {
    this.money += amount;
    this.hunts += 1;
    this.lastEarned = amount;
    this.save();
  }

  reset() {
    this.money = this.hunts = this.lastEarned = 0;
    this.save();
  }
}

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

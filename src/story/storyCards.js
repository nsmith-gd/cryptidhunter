// When to show the story cards (pure logic, no DOM, so it's testable):
//   - the intro once, at the start of a new game;
//   - the outro once, the first time reputation reaches its max.
// "Seen" flags are kept in memory (persisting them is for the save file later).
export class StoryCards {
  /** @param {{ show(id: 'intro'|'outro'): void }} o */
  constructor({ show, flags = { introSeen: false, outroSeen: false } }) {
    this.show = show;
    this.flags = flags;
  }

  /** Call once when the game boots. `isNewGame`: no hunts played and nothing earned yet. */
  start(isNewGame) {
    if (!isNewGame || this.flags.introSeen) return false;
    this.flags.introSeen = true;
    this.show('intro');
    return true;
  }

  /** Call whenever reputation changes. */
  reputationChanged(value, max) {
    if (this.flags.outroSeen || value < max) return false;
    this.flags.outroSeen = true;
    this.show('outro');
    return true;
  }
}

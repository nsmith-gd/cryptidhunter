import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryCards } from '../src/story/storyCards.js';
import { ReputationStub, REPUTATION_MAX } from '../src/story/reputation.js';
import { STORY_CARDS } from '../src/story/cardText.js';

const setup = () => {
  const shown = [];
  const rep = new ReputationStub();
  const story = new StoryCards({ show: (id) => shown.push(id) });
  rep.onChange((v, max) => story.reputationChanged(v, max));
  return { shown, rep, story };
};

test('a new game shows the intro (once)', () => {
  const { shown, story } = setup();
  story.start(true);
  story.start(true);
  assert.deepEqual(shown, ['intro']);
});

test('a returning game shows no intro', () => {
  const { shown, story } = setup();
  story.start(false);
  assert.deepEqual(shown, []);
});

test('reaching max reputation shows the outro exactly once; nothing before that', () => {
  const { shown, rep, story } = setup();
  story.start(false);
  for (const v of [10, 50, REPUTATION_MAX - 1]) rep.set(v);
  assert.deepEqual(shown, []);
  rep.set(REPUTATION_MAX);
  rep.set(REPUTATION_MAX - 20);
  rep.set(REPUTATION_MAX);
  rep.add(500);
  assert.deepEqual(shown, ['outro']);
});

test('card copy exists and is marked placeholder', () => {
  for (const id of ['intro', 'outro']) {
    assert.ok(STORY_CARDS[id].title && STORY_CARDS[id].body.length > 0);
    assert.match(STORY_CARDS[id].kicker, /placeholder/i);
  }
});

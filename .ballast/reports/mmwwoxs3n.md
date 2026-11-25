STATUS: DONE
- Following your answer: the TV-show story belongs later in development, not on the opening Bigfoot hunt, so the story cards are now switched off. A brand-new game opens straight on the Pine Hollow briefing, with no "Beyond the Treeline" intro, and there's no "LEGENDARY" finale card.
- The card system and its placeholder wording are kept (marked as not shown) so they can come back when the story is developed; for testing they appear only when `?cards` is added to the address.
- To see it: `npm run dev`, open the game fresh: you land on the hunt briefing. Capture in `.ballast/media/mmwwoxs3n/`.
- Known issue, only behind the testing switch: reputation now carries over between sessions but "finale already seen" doesn't, so with the cards switched on the finale re-shows after a reload. Not visible to players while the cards are off; to fix when the story returns. Build and unit tests pass.
- PR: PR_LINK

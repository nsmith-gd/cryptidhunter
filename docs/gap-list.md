# GDD v1.1 gap list (board task #80)

The current build (`main`, after #91) checked against every section of `docs/Cryptozoology_GDD_v1.1.md`.
Use it to pick up work: each section has a status and **the next concrete missing piece**, sized as one task.

**Status:** ✅ built (matches the GDD at its current gate) · 🟡 partial (some of it exists) · ❌ missing (nothing yet)

**⚖ Waiting on the director:** the build and v1.1 disagree on direction (GDD Appendix A.3). Don't start these until the director answers. The question number is given. Where the next piece doesn't depend on that question, it's marked "safe to start".

Item IDs (S5, E7, X7, ...) refer to the longer #64 audit in `docs/gdd-v1.1-audit.md`, which has more detail. This list supersedes its status column: many of its gaps have since been built (#66–#91).

## Summary

| § | Section | Status | Next concrete missing piece |
|---|---|---|---|
| 0 | Game identity | 🟡 | ⚖ Q1/Q2: decide the starter expedition and name; then the title/intro copy |
| 1 | Survival systems | 🟡 | S07 Hydration: thirst and drinking (water bottles exist as weight only) |
| 2 | Player attributes and interactions | 🟡 | Exertion engagement by level: stamina off in the tutorial tier (2.5) |
| 3 | Equipment catalogue | 🟡 | ⚖ Q9: map current gear onto catalogue IDs; safe to start: an item data table with mass/volume/price per GDD 3.2 |
| 4 | Evidence and research | 🟡 | E7 journal milestones (Lead → Located → Documented → Characterized → Confirmed) |
| 5 | Cryptid AI | 🟡 | A1 named awareness states with lost-contact → reset |
| 6 | Expedition structure and extraction | 🟡 | L7 outcome classes on the results screen (successful / partial / empty / emergency) |
| 7 | Economic simulation | 🟡 | M8 debrief ledger (gross, expenses, losses, closing cash) |
| 8 | Capture and containment | ❌ | Shared capture state machine stub (8.2), no creature yet |
| 9 | Death, failure and recovery | 🟡 | M10 resumable field save (autosave at departure/exit) |
| 10 | Headquarters and career | ❌ | M6 first-person HQ room greybox with a departure station |
| 11 | Narrative structure | ❌ | ⚖ Q1/Q2: premise; story cards are switched off |
| 12 | Level design | 🟡 | Seeded variation of resource locations per run (12.1) |
| 13 | UI, UX and audiovisual | 🟡 | Inventory screen with pack volume/mass and hold-to-discard (13.1) |
| 14 | Independent systems registry | 🟡 | System-ID registry doc + per-system snapshot read-only contract tests (14.1–14.2) |
| 15 | Gameplay gyms | 🟡 | G01 navigation and illumination gym (15.2) |
| 16 | PC and WebXR presentation | 🟡 | X7 measured frame times on a real desktop and Quest 3 (16.5) |
| 17 | Test and profiling toolkit | 🟡 | `samples.jsonl` survival samples + `frames.jsonl` in the export (17.4) |
| A | Appendix A alignment | 🟡 | Director answers to A.3 Q1–Q10 |

## By section

### 0. Game identity: 🟡
- [x] First-person 3D night hunt, pixel-art look, photos as evidence, desktop + WebXR entry.
- [ ] ⚖ Q1/Q2: v1.1 is "Cryptozoology", a Toronto career across 13 expeditions; the build is "Cryptid Hunter" with Pine Hollow/Bigfoot and Blackwater Swamp/Mothman.
- **Next:** the director's answers to Q1–Q3. Then rename and write intro copy to match.

### 1. Survival systems (16 systems): 🟡
- [x] S01 Nutrition, S02 Thermoregulation (#68). S03 Inventory and load (pack mass/volume, #69). S04 Navigation (paper map, compass, trail signs, #70). S08 Injury and medical, the only damage path (#72).
- [~] S05 Illumination: torch, batteries and night vision exist; v1.1 has no battery swaps in L01, and headlamp/lantern are missing. S06 Exertion: stamina exists, but is always on. S14 Threat exposure: noise and sight exist, scent and routine don't.
- [ ] S07 Hydration. S09 Sleep and fatigue. S10 Shelter and campcraft. S11 Equipment condition. S12 Energy and fuel. S13 Aquatic traversal. S15 Camp security. S16 Infrastructure.
- **Next:** S07 Hydration. Water bottles already sit in the pack (#69), but only as weight. Add thirst on the status screen, drinking from a bottle, and refilling at the creek with a risk (GDD 1.2, 2.2 P05). Safe to start.

### 2. Player attributes and system interactions: 🟡
- [x] Health, stamina, energy, body temperature and wetness. Walk-speed formula with a 45% floor (#83). Status screen with root causes and fixes (#71).
- [~] Fear meter exists; v1.1 says no fear meter (⚖ Q4). Interaction catalogue (2.7) covered only for the built systems.
- [ ] Attribute engagement by expedition (2.5): every system is on from the first hunt.
- **Next:** gate which meters are active per expedition tier (2.5 table), starting with stamina off in the tutorial tier. Safe to start.

### 3. Equipment and item catalogue: 🟡
- [x] 4 quick slots + pack (#69), shop (#46), viewmodels for held tools.
- [~] Gear set differs from the 98-item catalogue: bait, audio lure and knock stick aren't in v1.1. Trail camera, night vision and spare batteries come too early (⚖ Q9). Shop upgrades are levelled, not new items (⚖ Q10).
- [ ] Item data table with GDD IDs, mass, volume, price, condition. Rentals, resale.
- **Next:** one item table (`src/gear/items.js`) with each current item's GDD ID (C01 flashlight, F01 camera ...), mass, volume and price. Safe to start.

### 4. Evidence and research: 🟡
- [x] Creature photos scored on visibility. EV01 footprint photo, EV02 hair sample, EV04 disturbance photo, EV05 cast, droppings vial (#73, #84). Deer tracks as false leads (#84). Journal with Bayes confidence per cryptid.
- [~] Photo score formula differs from Q = 100×(0.30C+0.35I+0.20K+0.15P) (⚖ Q8). Clue hints say "heading north-east" (E8, may be an omniscient hint).
- [ ] E7 milestones and credibility. E6 lifecycle (trail-camera data lost unless you retrieve the camera). E9 one sighting = one event. E5 audio/video/thermal evidence (later levels).
- **Next:** E7: journal milestones Lead → Located → Documented → Characterized → Confirmed, each with its rule from 4.6, shown in the journal. Safe to start.

### 5. Cryptid AI and behaviour: 🟡
- [x] Shared controller with per-species behaviour trees (#53). Hearing and sight from real light (#21/#22). Bigfoot bluff/real charges by level. Wood knocks. Gym G00 proves render settings don't change AI.
- [~] States are close to v1.1's (5.3) but not named that way, and there's no lost-contact → reset step. Starter Bigfoot can hurt you (⚖ Q5).
- [ ] A2 hidden attributes (habituation, memory). A3 scent/vibration senses. A6 coarse far-away simulation.
- **Next:** A1: rename states to unaware → suspicious → investigating → identified → engaged → lost contact → reset, with hysteresis, and show them in the AI debug view. Safe to start.

### 6. Expedition structure and extraction: 🟡
- [x] Hunt start, deliberate extraction at the van, results screen, photos lost if caught (6.3–6.4).
- [~] 15-minute dawn countdown; v1.1 has no global deadline (⚖ Q6). One exit type only.
- [ ] Lead → Plan → Commit lifecycle (L1). Outcome classes (L7). Multi-day trips (L8).
- **Next:** L7: classify each hunt's outcome (successful / partial / empty / emergency / failed) on the results screen and in the save. Safe to start.

### 7. Economic simulation: 🟡
- [x] Money in the save file. Selling photos and physical evidence. Bounty board (#45). Shop (#46).
- [~] $ with no trip costs. Offer formula differs from T × B × M × N × A (⚖ Q8).
- [ ] M1 trip costs and starting $250. M5 recovery assignment. M8 debrief ledger.
- **Next:** M8: a debrief ledger on the results screen (gross sale, bounties, expenses, losses, closing cash) built from the existing sale data. Safe to start.

### 8. Capture and containment: ❌
- [ ] Nothing built. Tagging comes at L09, light capture at L10, heavy at L12.
- **Next:** 8.2 shared capture state machine as a pure module with unit tests, no creature hooked up yet. Low priority until late-game work starts.

### 9. Death, failure and recovery: 🟡
- [x] Health 0 or being caught ends the hunt. Unextracted evidence is lost. Gear and money are kept (9.1).
- [~] Save holds money, bounties, settings, camp (#15/#76); no field save.
- [ ] Resumable expedition snapshot (9.2). Injury recovery costs between trips (9.3).
- **Next:** M10: autosave at departure and at the van, plus resume of an interrupted hunt (seed, clock, position, evidence), using the #66 world seed. Safe to start.

### 10. Headquarters and career progression: ❌
- [ ] Base camp is a text panel on the start screen; v1.1 has a first-person HQ with stations.
- **Next:** M6: a greybox HQ room (apartment phase) with a case board and a departure door that starts the hunt. Safe to start; the look waits on ⚖ Q1.

### 11. Narrative structure: ❌
- [ ] Story cards are switched off; they tell a different premise (TV show) from v1.1's Toronto career.
- **Next:** ⚖ Q1/Q2. No writing until the premise is decided.

### 12. Level design: 🟡
- [x] Pine Hollow (#91) now meets 12.1–12.3: landmarks, loop trails, a lit trailhead, a readable physical edge, an observation stand, a risk gradient of traces toward the hollow, safe interiors, a signed route home. Blackwater Swamp exists.
- [~] Map edge near the trailhead clearing still shows the old flat treeline wall. Pine Hollow isn't one of v1.1's 13 expeditions (⚖ Q1).
- [ ] Seeded variation of resource locations (food, batteries) per run. L01 Toronto tunnel tutorial (⚖ Q1).
- **Next:** seed where pickups (food, batteries, first aid) lie in each map from the world seed, with authored candidate spots. Safe to start.

### 13. UI, UX and audiovisual presentation: 🟡
- [x] HUD, status screen (#71), journal, paper map, accessibility settings (FOV, sensitivity, remap, reduced shake, brightness, captions; #76), gamepad (#76), cinematic lighting, fog, pixel textures.
- [~] Inventory: the pack exists but there's no inventory screen with categories and hold-to-confirm discard. Sound (13.3): wood knocks and lure audio exist, but no spatial ambient bed.
- [ ] Debrief per 13.1 (verification explanation, buyer, next lead).
- **Next:** an inventory screen (I) listing worn, quick-slot and pack contents with mass/volume and hold-to-discard. Safe to start.

### 14. Independent systems registry: 🟡
- [x] Systems own their state and read others' snapshots (survival, health, status model). Fixed sim step (#66 sim loop). World seed (#66).
- [ ] No registry listing system IDs (S01–S16, P01–P12, X01–X10) and their owners. No contract tests that one system never writes another's state.
- **Next:** `docs/systems-registry.md` mapping each GDD system ID to its module, plus one test per survival system checking it only reads others' snapshots. Safe to start.

### 15. Gameplay gyms and playtest design: 🟡
- [x] G00 render-vs-gameplay bench (#77). One automated check per task (`npm run check:tNN`).
- [ ] G01–G09 gyms. 15.3 playtest protocol.
- **Next:** G01 navigation and illumination gym (15.2): a greybox course where you must find the exit with map, compass and a finite torch, with pass criteria. Safe to start.

### 16. PC and WebXR presentation: 🟡
- [x] Enter VR with safe pause (#74). VR controller parity, snap turn, teleport, vignette (#75). Desktop pixel pipeline (#35/#61).
- [~] Comfort: fear sway is off in VR; camera quality from tool pose not verified.
- [ ] X7 real-hardware performance: only software-rendered headless numbers exist (seconds per frame), so 60 FPS desktop / 72 Hz Quest 3 is unmeasured.
- **Next:** X7: run the F6 profiler for 20 minutes in Pine Hollow on a real desktop and a Quest 3 and commit the exports. **Needs a person with the hardware.**

### 17. Game test and profiling toolkit: 🟡
- [x] Minimal recorder: frame p95, stalls over 100 ms, evidence/economy events, F6 panel; exports `summary.json`, `events.jsonl`, `manifest.json` with the contract name (#67).
- [ ] `samples.jsonl` (survival values over time), `frames.jsonl`, `actions.jsonl`, `comparison.json`. Real build/gym IDs in the name (now "dev"/"none"). P03+ tools. 17.5 regression gate (>10% p95).
- **Next:** add `samples.jsonl` (health, energy, temperature, wetness, stamina once per second) and `frames.jsonl` to the export, listed in the manifest. Safe to start.

## Waiting on the director (Appendix A.3)
Q1 starter expedition (Pine Hollow vs Cabbagetown tunnels) · Q2 name · Q3 Bigfoot's place · Q4 fear meter · Q5 starter danger · Q6 dawn countdown · Q7 film vs digital camera · Q8 photo score and offer formula · Q9 gear set · Q10 upgrades vs new items. Sections 0, 11 and parts of 3, 4, 5, 6, 7 and 12 are blocked by these.

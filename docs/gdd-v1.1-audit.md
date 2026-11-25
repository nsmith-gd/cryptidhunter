# Game vs GDD v1.1: gap audit (board task #64)

Compares the build on `main` (Cryptid Hunter, after #45 evidence sale and bounty board) with `docs/Cryptozoology_GDD_v1.1.md`. Each line is a ticket candidate:

- **FIX**: change or extend an existing board section so it matches v1.1.
- **NEW**: work the board has no section for yet (a new section, or the next level of one).

Numbers in brackets are GDD sections. Excluded on purpose (already owned): #45 evidence sale/bounty board, #58/#59 Bigfoot rebuild and re-animation, #61 pixelation pipeline. Design-direction conflicts are listed in GDD Appendix A (#63). Where an item below depends on one of those decisions, it says **(pending A.3 Qn)**.

## What already matches v1.1

- First-person walk/sprint/crouch, stamina blocks sprinting only when spent (2.8), flashlight as the key light that also exposes you (1.2 S05, 2.9 loop 5).
- Cryptid senses: hearing from player noise, sight affected by light and crouching, no reading of hidden player state (5.2–5.3, 2.4); behaviour states roam → investigate → observe → flee/aggress, per-species parameters on one shared controller (5.2–5.3).
- Photos must actually show the creature to count; nothing pays for just pressing the shutter (4.1).
- Getting caught loses unextracted photos, keeps gear and banked money (6.4, 9.1).
- Extraction is a deliberate act at an exit (drive home from the van), with a debrief/results screen (6.1, 6.3, 7.5).
- Four quick slots for gear (13.1).
- Persistent money and base camp state between hunts (2.12, 9.2) via the save file.
- Pixel-art textures, lighting-led mood, fog/atmosphere (0, 13.2), palette and grades.

## 1. Core loop and expeditions

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| L1 | NEW | No Lead → Plan → Commit → Arrive → Investigate → Extract → Debrief → Recover lifecycle; a hunt starts on click with no trip planning or commit step | 6.1 | Base camp start screen is the nearest thing |
| L2 | NEW | L01 Cabbagetown tunnel tutorial (escape-focused, creature retreats, 15–25 min) doesn't exist | 1.3, 6.2, 12.2, 15.2 G01 | (pending A.3 Q1) |
| L3 | NEW | None of the 13 v1.1 expeditions or their cryptids exist; the build has Pine Hollow/Bigfoot and Blackwater Swamp/Mothman | 1.3, 6.2, 12.2 | (pending A.3 Q1, Q3) |
| L4 | FIX | Night Hunt uses a 15-min global dawn countdown; v1.1 has no global timer, a field clock advanced by actions, a 20-min day/night baseline and interruptible fast-wait | 6.5, 12.1 | (pending A.3 Q6) |
| L5 | FIX | Only one exit type (van). v1.1 has exit classes (on foot/vehicle, dock, pickup, emergency withdrawal at a cost, live delivery) and a frozen manifest on commit | 6.3 | |
| L6 | FIX | Destination unlock uses a reputation number; v1.1 needs extraction + Documented milestone + affording the next trip | 6.4, 7.1 | (pending A.3 Q10) |
| L7 | NEW | Expedition outcome classes (successful / partial / empty / emergency / failed capture → evidence-only) aren't distinguished in results | 6.4 | Results screen exists (#31) |
| L8 | NEW | Multi-day trips, sleep and camps (from L03) | 6.2, 1.2 S09–S10 | |
| L9 | FIX | Each map must guarantee one low-risk indirect evidence opportunity and a readable withdrawal route; not enforced or checked | 5.5, 12.1–12.2 | Clue zones (#48) are close |

## 2. Survival systems and player attributes

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| S1 | NEW | S01 Nutrition: hunger/energy reserve, food items, eating (L01 system) | 1.2, 2.2 P02 | Missing entirely |
| S2 | NEW | S02 Thermoregulation: core temperature, wetness, insulation, heat sources (L01) | 1.2, 2.2 P03, 2.3 D01 | Creek/swamp wading could feed wetness |
| S3 | NEW | S03 Inventory & load: pack with mass/volume, worn layers, hands; load slows and tires you | 1.2, 2.3 D03, 3.5, 13.1 | The 4-slot loadout covers quick slots only |
| S4 | NEW | S04 Navigation: paper map, compass, landmarks; getting back to the exit is the task | 1.2 | The compass strip from #3 is a start |
| S5 | FIX | S05 Illumination: L01 flashlight is finite with no battery swaps; headlamp, lantern, low-output lamp later; light exposure shared by AI and evidence | 1.2, 3.2 C01/C05, 13.2 | Battery swaps and pickups exist now |
| S6 | FIX | S06 Exertion: stamina should be disabled in L01 and come in at L02 with load × terrain cost | 2.5, 2.8 | Stamina is always on |
| S7 | NEW | S07 Hydration (L02) | 1.2, 2.2 P05 | |
| S8 | NEW | S08 Injury & medical: health 0–100, wounds/bleeding, treatment, first-aid/trauma kits; only S08 deals damage | 1.2, 2.2 P01, 9.1, 14.1 | Today a touch ends the hunt |
| S9 | NEW | S09 Sleep & fatigue, S10 Shelter & campcraft (L03) | 1.2 | |
| S10 | NEW | S11 Equipment condition & repair (L04) | 1.2, 7.4 | |
| S11 | NEW | S12 Energy & fuel budget (L05), S13 Aquatic traversal (L05/12/13) | 1.2 | Swamp water slows you, but there's no swimming or drowning |
| S12 | FIX | S14 Threat exposure: v1.1 adds scent and routine to noise and visibility | 1.2, 2.4 | Hearing and sight exist (#21); scent and routine are missing |
| S13 | NEW | S15 Camp security (L11), S16 Infrastructure (L12) | 1.2 | Late-game |
| S14 | FIX | Fear meter conflicts with "no mandatory fear/sanity meter"; v1.1 fear comes from cues and real threats | 2.4, 9.1 | (pending A.3 Q4) |
| S15 | NEW | Status screen (six attributes, conditions, causes, recovery) and cause-naming warnings ("Wet clothing: losing heat faster") | 2.11, 13.1 | HUD bars exist for stamina, battery, fear |
| S16 | NEW | Anti-death-spiral rules: visible warning before damage, grace periods, one damage path | 2.8 | Needs S08 first |

## 3. Evidence and research

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| E1 | FIX | Photo quality uses visibility × steadiness × (centring + size); v1.1 uses Q = 100×(0.30C+0.35I+0.20K+0.15P)×integrity with grades 0–4, judged at HQ after extraction | 4.5 | (pending A.3 Q8). #50's factors map naturally onto C (steadiness/size) and K (visibility) |
| E2 | FIX | Starter camera should be a used digital compact (weak in low light, stills); film rolls belong to an L08 analogue camera | 3.2 F01/F14/F15, 4.2 | (pending A.3 Q7). Film roll/album #51 |
| E3 | NEW | Quality ≠ authenticity: a clear photo of an ordinary animal is rejected; ordinary animal signs as false leads | 4.4–4.5 | No ordinary wildlife in the game |
| E4 | NEW | Collectable physical evidence: footprint photos, sample pouches, casts, biological samples, disturbance photos (EV01–EV06) | 4.2 | Clues can only be examined; they aren't evidence you sell |
| E5 | NEW | Audio, video, thermal, sonar, telemetry evidence and their tools (EV07–EV13) | 4.2, 3.2 F05–F17 | Later levels |
| E6 | FIX | Evidence lifecycle: observed → collected → secured → extracted → verified → sold/archived; trail camera data is lost if the camera isn't retrieved | 4.3 | Trail cameras report straight to the hunt today |
| E7 | FIX | Journal milestones (Lead → Located → Documented → Characterized → Confirmed) with credibility awards and per-event confidence, instead of a 3-clue verdict | 4.6 | Journal #20 |
| E8 | FIX | Clue hints point along the true route ("heading north-east"); v1.1 says no omniscient markers | 4.4, 13.1 | Could become a readable track direction you infer yourself |
| E9 | FIX | Event-based evidence: several photos of one sighting are one event and don't multiply value; novelty 1.0 → 0.5 → 0.25 → 0 for duplicates | 4.4, 4.7 | Settlement currently takes the best per subject (close in spirit) |

## 4. Cryptid AI

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| A1 | FIX | Awareness states should be unaware → suspicious → investigating → identified → engaged → lost contact → reset, with utility scoring and hysteresis | 5.3 | #22/#53 states are close; naming and lost-contact/reset are missing |
| A2 | NEW | Hidden attributes (energy, condition, alertness, fear, curiosity, aggression, territoriality, intelligence, habituation, memory) | 5.2 | Some exist as profile numbers |
| A3 | NEW | Scent, vibration, electrical and camera-coverage senses; routine memory (Dogman learns your routes) | 5.3 | |
| A4 | FIX | Starter creature should be elusive/harmless; hostility first at L06; every encounter telegraphs with a viable retreat | 5.1, 5.5 | Bigfoot can catch you on first touch (pending A.3 Q5) |
| A5 | FIX | Mothman should be an environmental disruptor (electronics fail, weather) at L08, not a catcher | 5.4 | (pending A.3 Q1, Q3) |
| A6 | NEW | Distant creatures at coarse fidelity; contained creatures stay simulated and can escape | 5.6 | Performance + capture |
| A7 | FIX | No guaranteed sighting; escalation follows exposure, not play time | 5.5 | Dawn makes Bigfoot leave on a timer |

## 5. Economy, base camp and career

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| M1 | FIX | Money should be CAD starting at $250 with a cost to every trip (L01 $25) and a payout ceiling T per expedition | 3.6, 7.1–7.3 | No trip costs now |
| M2 | FIX | Offer = T × 0.01 × base × grade multiplier × novelty × buyer affinity; buyer tiers unlocked by expedition and credibility | 4.7, 7.2 | Excludes the bounty board (#45) |
| M3 | FIX | Gear prices, resale at 50% × condition, repair 35%, rental deposits 20% | 3.6, 7.4 | Shop #46 |
| M4 | FIX | Upgrades are new items (e.g. telephoto F08), not levelled permanent upgrades | 3.1, 3.4, 10 | Shop #46 (pending A.3 Q10) |
| M5 | NEW | Recovery assignment: a fixed $100 local survey offered when you can't afford any trip | 7.4 | |
| M6 | NEW | First-person 3D headquarters with stations (case board, computer, bench, storage, departure), evolving through 5 phases | 10 | Start-screen panels today |
| M7 | FIX | Gear catalogue: bait, audio lure and knock stick aren't in v1.1; trail camera (L04), night vision (L09) and spare batteries (L05) are given from hunt 1 | 3.2–3.4 | (pending A.3 Q9) |
| M8 | NEW | Prep screen (costs, at-risk gear, estimated evidence range) and debrief ledger (gross, expenses, losses, deposits, closing cash) | 7.5 | Results screen shows part of the debrief |
| M9 | NEW | Injury recovery charges between trips (5% / 10% of operating envelope) | 9.3 | Needs S08 |
| M10 | FIX | Save: autosave at departure/sleep/exit, resume restores clock/seed/position/creature state, multiple career slots, explicit export/import in the browser | 9.2, 16.1 | #15 saves money only |
| M11 | NEW | Capture and containment (tagging L09, light capture L10, heavy capture L12) with integrity and condition | 8 | Late-game |
| M12 | NEW | Narrative: Toronto resident career, buyer correspondence, five acts, the Ancient lead and canonical disappearance ending | 11 | Story cards (off) are a different premise |

## 6. Desktop and WebXR

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| X1 | NEW | WebXR immersive-vr session: secure context, `navigator.xr`, `isSessionSupported`, user-gesture entry, `XRSession.requestAnimationFrame`, floor-relative space, safe pause on session/visibility/tracking loss | 16.1 | No VR code today |
| X2 | NEW | VR input parity: tracked controllers, snap turn 30/45° default, optional smooth turn with vignette, validated teleport, seated/one-handed play | 13.1, 16.2–16.3 | |
| X3 | NEW | VR presentation: world-space wrist/status panel, world-space text, camera quality from the tool pose (not head pose or zoom) | 2.11, 16.2 | Camera zoom currently narrows the view |
| X4 | NEW | Gamepad input on desktop | 13.1 | Mouse/keyboard only |
| X5 | FIX | Comfort: no head bob/roll/shake in VR; reduced shake option on desktop; brightness never changes detection | 13.1, 13.2, 16.3 | `?vr` already turns off fear sway |
| X6 | FIX | Fixed simulation step with render interpolation; consumption must not depend on frame rate | 14.2, 16.1 | Game uses a capped variable dt |
| X7 | NEW | Performance targets: desktop 60 FPS at 1080p (p95 ≤ 13.33 ms), Quest 3 72 Hz floor (p95 ≤ 11.11 ms), no stalls > 100 ms, 20-min stability | 16.5 | Headless runs are currently a few FPS with the forest art; real-hardware numbers unmeasured |
| X8 | NEW | Accessibility settings: FOV, sensitivity, remapping, subtitles/visual cues, brightness, colour-independent labels | 13.1 | |
| X9 | NEW | Spatial audio with captions that give direction without naming species | 13.3 | Wood-knock audio exists |

## 7. Gyms and profiling

| # | Type | Gap | GDD | Notes |
|---|---|---|---|---|
| G1 | NEW | Gameplay gyms G00–G09 as their own greybox scenes with fixed seeds, fixture reset, debug HUD, event trace and blind mode; first milestone G00–G04 + G08 stub | 15.1–15.2, 14.2 | Today: one check script per task, mostly on the test yard |
| G2 | NEW | G08 headless economy/persistence harness: 100 seeded careers, accounting invariants | 15.2 | `npm test` has unit tests only |
| G3 | NEW | Shared profiling service and tools P01–P12 (minimal recorder first: P01, P02, P05, P07, P12) | 17.1–17.2, 17.6 | |
| G4 | NEW | JSON exports: `summary.json`, `events.jsonl`, `samples.jsonl`, `frames.jsonl`, `actions.jsonl`, `comparison.json`, `manifest.json`, named `cryptozoology_<build>_<gym>_<scenario>_<platform>_<seed>_<run-id>`; schema fields as in 17.4 | 17.3–17.4 | |
| G5 | NEW | Gates: state ownership, sim parity at 60/72/90 + headless, AI fairness, perf, regression (>10% p95), 20-min stability, 4/5 human playtests | 17.5, 15.3 | |
| G6 | FIX | Determinism: same seed + input trace + fixture gives the same state and ledger; checks currently use `Math.random` worlds and wall-clock waits | 14.2 | Many checks are flaky for this reason |
| G7 | FIX | Pixel/render settings must never change AI detection or evidence (gym G00 pass criterion) | 15.2 G00, 13.2 | Relates to #61; this is the test, not the pipeline |

## Suggested first tickets

These are the cheapest steps toward v1.1 that don't wait on the A.3 decisions:

1. G3/G4: a minimal profiling recorder (frames, survival samples, evidence/transactions) that exports `summary.json`.
2. X6: fixed simulation step.
3. G6: seeded worlds for checks, so automated checks stop being flaky.
4. X1: a WebXR "Enter VR" entry point with safe pause.
5. S3: pack mass/volume behind the 4 quick slots.
6. S15: a status screen with cause-naming warnings.
7. E4: collectable footprint photos and samples as sellable evidence.

# Cryptid Hunter

First-person cryptid-hunting game. Three.js + Vite (web), rendered at low internal resolution for a 3D pixel-art look.

## Run
```
npm install
npm run dev        # open the printed URL, click to play
npm run build      # production build into dist/
```

Controls: WASD move · mouse look · Shift sprint · Ctrl or C crouch (hold) · F flashlight · E examine clue · J journal · hold right mouse to raise the camera, left click to snap · G drop bait · R swap battery · Esc releases the mouse.

## Maps
Add `?map=swamp` to the URL for Blackwater Swamp (greybox): boardwalks, wading water that slows you, and the old bridge.

## Checks
`npm run check:t11` drops bait (G) and checks Bigfoot walks to it and eats it; screenshots to `.ballast/media/t11/`.

`npm run check:t10` checks the swamp: wading speed, boardwalk connectivity, and walks the boardwalk route; screenshots to `.ballast/media/t10/`.

`npm run check:t2` checks the flashlight toggle in the dark map and writes screenshots to `.ballast/media/t2/`.

`npm run check:t14` plays the full greybox hunt loop. Open `/?sandbox` to also get the Mothman and Chupacabra placeholders.

`npm run check:t22` walks the cryptid AI through its states. F4 toggles the AI debug overlay.

`npm run check:t48` plays a full hunt on Pine Hollow (`?map=forest`): start, trail, photo, van.

`npm run check:t1` builds, opens the greybox map headlessly, drives the player and writes screenshots to `.ballast/media/t1/`.

`npm test` runs unit tests. `npm run check:t3` lets Bigfoot leave a trail, then a bot follows three clue hints (W/D/E key presses only) and checks it moves along Bigfoot's route toward it; screenshots go to `.ballast/media/t3/`.

Maps: add `?map=forest` (Pine Hollow Forest, 300 x 300 m starter map) or `?map=swamp` to the URL. `npm run check:t9` walks the forest end to end and routes Bigfoot around the ridge; captures go to `.ballast/media/t9/`.

Fear (FEAR bar, top-left) rises in the dark, near cryptids and on jump scares; your torch, lamps and fires lower it, the van fastest. Above about a third, your view sways and photos come out shaky (lower score). `npm run check:t25` verifies it.

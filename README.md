# Cryptid Hunter

First-person cryptid-hunting game. Three.js + Vite (web), rendered at low internal resolution for a 3D pixel-art look.

## Run
```
npm install
npm run dev        # open the printed URL, click to play
npm run build      # production build into dist/
```

Controls: WASD move · mouse look · Shift sprint · Ctrl or C crouch (hold) · F flashlight · R swap battery · Esc releases the mouse.

## Maps
Add `?map=swamp` to the URL for Blackwater Swamp (greybox): boardwalks, wading water that slows you, and the old bridge.

## Checks
`npm run check:t10` checks the swamp: wading speed, boardwalk connectivity, and walks the boardwalk route; screenshots to `.ballast/media/t10/`.

`npm run check:t2` checks the flashlight toggle in the dark map and writes screenshots to `.ballast/media/t2/`.

`npm run check:t1` builds, opens the greybox map headlessly, drives the player and writes screenshots to `.ballast/media/t1/`.

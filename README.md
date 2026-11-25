# Cryptid Hunter

First-person cryptid-hunting game. Three.js + Vite (web), rendered at low internal resolution for a 3D pixel-art look.

## Run
```
npm install
npm run dev        # open the printed URL, click to play
npm run build      # production build into dist/
```

Controls: WASD move · mouse look · Shift sprint · Ctrl or C crouch (hold) · F flashlight · R swap battery · Esc releases the mouse.

## Checks
`npm run check:t2` checks the flashlight toggle in the dark map and writes screenshots to `.ballast/media/t2/`.

`npm run check:t1` builds, opens the greybox map headlessly, drives the player and writes screenshots to `.ballast/media/t1/`.

`npm test` runs unit tests. `npm run check:t3` lets Bigfoot leave a trail, then a bot follows three clue hints (W/D/E key presses only) and checks it moves along Bigfoot's route toward it; screenshots go to `.ballast/media/t3/`.

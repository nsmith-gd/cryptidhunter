# Cryptid Hunter: 3D Pixel Art Style Guide

**One line:** hand-painted pixel textures on simple low-poly shapes, shown through a low-resolution, nearest-neighbour camera, lit like a film at night. The textures are pixel art; the lighting is cinematic and real.

Reference bar (on `ballast/targets`): *ex* (low-poly + pixel textures, warm practical light in the dark), *ex2* (bold painted outlines and chunky texels), *ex3* (pixel assets under cinematic light, haze and depth), *ex4* (warm/cool contrast, long shadows), *ex5* (pixel-textured boardwalks, grass cards, muted swamp palette), *slurpee run* (night: pools of warm light against a cold sky).

## 1. Texel density (the one number everyone follows)

| Surface | Texels per metre | 1 texel | Typical tile |
|---|---|---|---|
| World surfaces (ground, bark, rock, wood, walls) | **32** | 3.125 cm | 32×32 = 1 m, 64×64 = 2 m |
| Hero props, creature faces and hands | **64** | 1.6 cm | 16×16 face, 32×32 prop |
| Cards (grass, reeds, moss strands, leaves) | 32 | 3.125 cm | 32×32 alpha-cut |

- The game renders at **1/3 of screen resolution** and scales up with nearest-neighbour (640×360 at 1080p). At 32 texels/m, one texel is about one render pixel at 7 m and 2–3 render pixels within arm's reach: crisp, never mushy.
- **Never mix densities on neighbouring surfaces.** Set UVs from real-world size (planks, trunks and walls are tiled per metre in code, never stretched).
- Textures use nearest sampling (`NearestFilter`, `NearestMipmapNearest`); no blurry filtering, no texture larger than 64 px on a side unless it's a unique hero face.

## 2. Palette

The master palette is in `src/art/palette.js` (sheet: `docs/style/palette.png`). 15 ramps of 4–7 colours: bark, wood, needles, moss, grass, dirt, litter, rock, lichen, water, fur, skin, warm, night, rust.

- **Paint only with palette colours.** Need a new colour? Add a ramp entry, don't freestyle.
- Ramps are **hue-shifted**: shadows lean cool (blue/violet), lights lean warm (yellow/orange). This is what keeps surfaces rich under cold moonlight and glowing under lanterns.
- **No pure black, no pure white.** Darkest is a coloured near-black (`#0b1416`, `#161219`…); brightest highlights stay off-white (`#ffe6a8`, `#b6c6dc`).
- Saturation budget: the world is muted (moss, bark, rock, needles). **Saturated colour is reserved** for things that matter: warm practical lights, eyeshine, clues (fresh blood, broken leaves), UI.

## 3. Painting rules: outlines and shading

- **Outlines are painted, not post-processed.** Use the darkest ramp colour, 1 texel wide, on material breaks: plank edges and gaps, bark fissures, rock cracks, the underside of pebbles and leaves. No black outline shader around meshes; silhouettes come from value contrast and light.
- **Value bands, not gradients.** Shade in 3–5 posterised steps per ramp. Where two bands meet, blend with a 4×4 ordered (Bayer) dither, only at the edge, never as an all-over noise.
- **Soft top light is painted in:** highlights on upper edges and lips (plate rims, rock ledges, plank tops), contact shadow under objects. Never paint a strong directional light or a cast shadow: real lights do that.
- **Wear tells the story:** knots, nails, rust drips, lichen, moss in crevices, a missing plank. Every texture should have one or two focal details and a lot of quiet surface around them.
- **Everything tiles.** Paint with wraparound (all noise and features are periodic); check every tile 2×2 before it ships (see `docs/style/texture-set.png`).
- Geometry stays simple and chunky (flat shading, 6–10 sided trunks, tapered boxes). Detail lives in the texture, shape lives in the silhouette.

## 4. Lighting and the render pass (where "cinematic" comes from)

- **Key:** cold moonlight (`night` ramp), low in the sky so trunks throw long shadows across trails.
- **Practicals:** warm lights (`warm` ramp: lanterns, campfire, cabin window, van headlights, the bridge lamps) are the focal points of every view. Aim for at least one warm pool on screen in a typical frame.
- **Flashlight:** near-neutral warm white, tight cone; the only way to read texture detail far from practicals. Darkness outside the beam is intentional.
- **Haze:** exponential fog coloured to match the horizon, so distant trees become layered silhouettes (depth in planes, as in *ex3*).
- **Render pass:** 1/3 resolution, nearest upscale, no anti-aliasing, shadows on. Planned additions, in this order: bloom on practicals only, subtle vignette, and depth of field for cutscenes/photos.

## 5. Mockups (rendered with the game's renderer and textures)

| | |
|---|---|
| `docs/style/palette.png` | Master palette, all ramps with hex values |
| `docs/style/texture-set.png` | Pine Hollow texture set at 32 texels/m, each tiled 2×2: bark, dirt, leaf litter, moss, granite, grass, needles, grass card |
| `docs/style/mockup-trail-moonlight.png` | Night trail: moon key, haze layers, warm lantern pool on the dirt trail |
| `docs/style/mockup-boulder-torch.png` | Flashlight on a mossy granite boulder: texture detail revealed by the beam |
| `docs/style/mockup-lantern-low.png` | Low angle by the lantern: warm vs cold, grass cards, bark at arm's length |
| `.ballast/media/t32/02-boardwalk-reeds.png` | Swamp: plank boardwalk under the torch, reeds (applied in game) |
| `.ballast/media/t24/01-face-three-quarter.png` | Creature: Bigfoot with painted fur, face and eyeshine (applied in game) |

Regenerate the mockups with `node tools/capture-t33.mjs` (renders `tools/styleboard/`).

## 6. Checklist before an asset ships

1. Texel density matches the table (measure a known-size surface).
2. Every colour comes from the palette; nothing pure black/white.
3. Material breaks have a 1-texel dark outline; bands are posterised with edge-only dither.
4. Tiles 2×2 with no seams.
5. Reads as a silhouette with the torch off, and shows its detail with the torch on.
6. One focal detail, lots of quiet; no confetti.

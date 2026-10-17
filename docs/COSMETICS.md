# Local wardrobe and cosmetic authoring

The wardrobe is local development functionality. Classic, Mint and Rose ducks
and Meadow, Dusk and Winter worlds are freely selectable test content, not
commercial inventory or approved launch artwork. Accounts, purchases and
authoritative ownership remain separate features.

## Player flow

Open **Wardrobe / Гардероб** outside a flight: before starting, while paused or
after death. Select a duck and background to preview their combination. **Apply**
equips both and closes the frame; Close or Escape discards the draft. Opening or
closing the wardrobe does not start, resume or restart a run. Menu and wardrobe
frames are mutually exclusive.

Equipment saves on this device when browser storage works. A storage failure
keeps selection available for the current session with a saving warning. Tabs
have independent equipment state; there is no cross-tab synchronization.

## Add or replace content

The web application's `src/wardrobe.ts` owns the skin/background catalogs and
equipment resolution. Each entry has a stable ID, Russian and English names,
and a procedural appearance fallback. Skins and backgrounds are selected
independently. Keep collectible colors and gameplay rules separate from the
cosmetic world palette.

To add a cosmetic:

1. Add an entry to the appropriate catalog with a unique, permanent ID and both
   names. Catalog validation rejects duplicate IDs.
2. Supply its fallback appearance. Skin entries provide the duck appearance;
   background entries provide the world palette, including readable pipes.
3. Optionally supply image resources using the catalog's image fields. Keep
   resources bundled locally; final art must have an approved source/license
   record before release.
4. Check preview and gameplay together, both languages, and the fallback with
   resources unavailable. Extend catalog tests for the new entry.

To replace temporary artwork, retain the entry's ID and update its appearance
and image resources. Existing saved equipment then resolves to the new art.
Removing or renaming an ID makes saved selections fall back to the default for
that category; it does not invalidate the other selected category.

For example, add the following optional field to the existing `rose` skin entry
after placing the images in `apps/web/src/assets/`:

```ts
image: {
  body: new URL('./assets/rose-body.png', import.meta.url).href,
  wing: new URL('./assets/rose-wing.png', import.meta.url).href,
},
```

A world entry uses `image: { background: new URL('./assets/winter.png',
import.meta.url).href }` instead. Omit any resource to retain that part's
procedural drawing. These URLs are resolved relative to `wardrobe.ts` and
bundled by Vite. No wardrobe screen or saved-equipment changes are needed.

## Image convention

| Resource | Logical dimensions | Placement |
| --- | --- | --- |
| Duck body | 64 × 48 | Transparent image, centered at (32, 24) on the duck origin |
| Duck wing | 32 × 20 | Transparent image, centered at (16, 10), offset (−5, 2) from the duck origin |
| Background | 360 × 580 | Fills the existing presentation viewport behind gameplay |

Higher-resolution resources use these same logical dimensions. Body and wing
remain separate so the existing wing motion and duck tilt can continue. Keep
the silhouette consistent with the existing duck: cosmetics do not change its
collision bounds. Background images do not define pipes, collision geometry,
collectible placement or a new gameplay map.

Resources load asynchronously through Pixi. Procedural art remains usable while
loading or after failure. Selection changes and unmount must ignore stale load
completions, and renderer cleanup must not destroy shared cached textures.
Preview and gameplay share cosmetic rendering helpers; preview does not advance
the simulation.

## Persistence and boundaries

The `doofy-duck:wardrobe:v1` local-storage record contains version 1 and an
`equipment` object with `skinId` and `backgroundId` only. Missing/corrupt records
use defaults; unknown IDs fall back independently. This record is an untrusted
local preference, never proof of ownership.

Cosmetics must not enter run descriptors, physics configuration, simulation RNG,
scores or replay identity. Relevant unit tests cover catalog resolution,
persistence, draft/apply behavior and resource lifecycle. Run the root routine
checks after code changes; browser suites and real Telegram/device acceptance
remain separate, on-demand verification.

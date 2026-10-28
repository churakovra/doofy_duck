# Cosmetic authoring

The account shop owns the player-facing catalog and equipment flow. The Economy
service defines offers in `services/platform/app/economy/shop/catalog.py`. It
checks ownership and stores equipment. The client previews offers in
`AccountShop.tsx` and resolves their procedural palettes in
`account-shop-assets.ts`. Unknown assets fall back to the default appearance.
See the [shop contract](../contracts/http/economy-shop-v1.md) for purchases and
equipment.

To add or change an account cosmetic, coordinate stable server item IDs, names,
prices and client appearance mappings. Check both languages, preview, equipment
and ownership. Approved artwork and release policy remain separate decisions.
Cosmetics do not change physics or collision bounds.

`wardrobe.ts`, `GameWardrobe.tsx` and the image helpers also contain legacy local
wardrobe functionality. The account game does not use its local storage as proof
of ownership. The image conventions below describe those helpers. The account
shop currently resolves procedural palettes and does not use these image fields.

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

## Boundaries

The legacy `doofy-duck:wardrobe:v1` record is a local preference. It does not
authorize account equipment. Cosmetics do not enter simulation identity, physics,
scores or replay. Preview and gameplay share rendering helpers.

# Doofy Duck UI direction

## Product and use context

Doofy Duck is a friendly, short-session arcade game built for touch play, with a Telegram Mini App as a future host. Keep the game frame playable on narrow portrait phones and short landscape screens, centered within Telegram's stable viewport and system/content safe areas. The canvas and every interface layer share that fixed 360:580 frame.

## Visual direction

Keep the warm cream background, forest green actions, and golden collectible accents. Use the existing system sans-serif stack for dependable loading and readable interface text; use a restrained serif only for short screen headings. The duck and its world remain the visual focus. Cards use opaque cream surfaces, quiet borders, and soft shadows so they stay legible over the scene.

## Layout and hierarchy

- Fit one fixed 360:580 frame inside the stable viewport and safe areas. Keep its dimensions unchanged across READY, RUNNING, PAUSED, and DEAD.
- Fill the frame with one canvas scaled without distortion. Keep the compact score, best score, menu, balances, wallet state, and cards inside that same frame.
- In RUNNING, show only the current score as a large plain number near the top center. It is not a control. Hide the brand, best score, menu, wallet, cards, and touch hint for the whole flight.
- In READY, PAUSED, and DEAD, restore the full compact HUD, local balances, wallet state, and appropriate action card.
- Group currency icons and balances in a top-right panel beside an equally sized Score/Record panel and Menu. Keep full balance descriptions in wallet settings and accessible labels, and local storage status in the footer.
- Show the RU/EN choice in settings as a cream dropdown with a forest-green focus ring, readable in-panel list rows, and a clear selected checkmark.
- Keep ready, paused, and completed-run cards within the game frame. Let card content scroll on short screens and retain one clear primary action.
- Hide keyboard-only hints on touch devices. Keep all buttons at least 44px high with visible focus.
- Respect Telegram stable-height and safe-area CSS variables, with browser safe-area environment variables as fallbacks.

## Type, spacing, and color

- Body text starts at 14px; secondary status and labels stay at or above 12px, with 10–11px reserved for compact text in the shortest landscape footer.
- Use a consistent 4px/8px spacing rhythm and 48px default touch controls.
- Primary text: `#263b32`; supporting text: `#43584a`; paper: `#fffdf7`; background: `#f5f2e9`; forest action: `#426b53`; gold accent: `#d39a31`; border: `#e4dfd2`.
- Use dark green or ink for small text. Do not use pale muted text for essential information.

## Interaction and accessibility

- Keep field taps dedicated to flight input. Buttons stop pointer propagation.
- Pause automatically when the app is backgrounded. Returning shows the paused card and requires explicit resume. There is no manual pause control during play.
- Disabled start states explain whether wallet access is still being checked or is held by another tab.
- Show local storage status in the game view. Put the distinction between in-game Stars and Telegram Stars (XTR) in wallet details and completed-run details.
- Keep both English and Russian messages natural and equivalent. Use semantic buttons, named icon controls, keyboard focus, and reduced-motion support.

## Avoid

- Marketing-page hero, testimonials, or other conversion patterns in the live game.
- Shrinking the whole game interface to match the canvas ratio.
- Cropping or stretching the playfield to fill a phone screen.
- Tiny wallet disclosures, low-contrast small text, decorative emoji controls, or keyboard instructions on touch screens.

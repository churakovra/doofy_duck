# Web application

Read the root instructions and [code map](../../docs/ARCHITECTURE.md). `Game.tsx`
composes run, progress, audio, and rendering hooks; follow that ownership when
making changes. Keep gameplay rules in `@doofy-duck/game-sim`.

- Render state and cosmetic feedback without consuming gameplay RNG or changing
  authoritative hitboxes. Respect reduced motion and bound effect pools.
- Preserve fixed-step timing, input deduplication, explicit resume, and error
  handling. UI controls must not also flap.
- Preserve serialized Pixi initialization/destruction under React StrictMode.
- Wallet ownership must precede persistent gameplay/settlement. Keep settlement
  deduplication and explicit memory-only fallback; stored data is untrusted.
- Audio unlocks from user activation; pause/background/unmount must clean up.
- Keep gameplay coordinates/visibility consistent when scaling the viewport.

From the repository root, use relevant `npm test -- <test-path>` cases,
`npm run typecheck`, and `npm run lint` for code changes. `npm run test:browser`
builds and uses isolated production preview at 4174. `npm run test:dev` uses
isolated development at 4175 and exercises StrictMode startup/reload. Manual
development uses `npm run dev` at 4173. Test files occur in both `src` and `test`.
Browser automation does not establish physical Telegram/mobile behavior.

# Doofy Duck — current product direction and next delivery gates

Status: owner decisions recorded October 14, 2026. This document supersedes the audience, feature-priority, visual-selection, and distribution assumptions in PRODUCT_RESEARCH.md. Research findings remain historical evidence; proposed policies are not automatically accepted.

**Latest scope correction:** `GAME_V1_SPEC.md` is the proposed v1.0.0 gameplay scope. It supersedes the broader near-term delivery sequence below: first build simple flight, pattern-generated pipes, pipe scoring, occasional configurable collectibles, and reliable run lifecycle. Economy modeling, additional activities, social features, and final art are not prerequisites to this foundation. They remain later product work.

## Accepted direction

- Audience is now **18+**, Russian-language, initially CIS-focused. Exact launch countries, operator location, eligibility checks, and age-gate implementation remain unresolved. An intended age restriction is not a verified control or launch clearance.
- Commercial objective: a sustainable, profit-oriented game. Encourage voluntary purchases and make internal currency desirable to spend; fund and bound redeemable rewards rather than promise unlimited earning.
- Acquisition hook remains earning in-game Stars and redeeming eligible points for gifts. Actual internal-point issuance, gift funding, and conversion/catalog policy are not approved yet.
- The game must be enjoyable on its own: appealing design, varied patterns, challenges, boosters, mastery, meaningful choice, friends, and leaderboards.
- Owner wants challenge/booster pacing inspired in general by runner games such as Subway Surfers, adapted to single-tap flight. This does not approve copying proprietary art, maps, or implementation.
- Same-seed friend challenges are approved as a direction; fair comparison and deterministic Core design are prerequisites.
- Daily route with challenges/rewards is approved as a direction. Reward kind, limits, attempts, resets, and eligibility remain to be designed.
- Currency sinks and optional paid products remain important: cosmetics, world appearances, effects, boosters, and continues. Paid randomized items were requested previously but have no approved odds, economics, or launch clearance.
- Failure-sharing cards/replays move to the backlog and are excluded from near-term scope. Challenge sharing is a separate approved feature.
- Existing visual concepts are **not accepted**. Art direction will be explored separately later. Modern pixel/cozy/expressive preferences are useful inputs, not an approved art system.
- Owner plans audience acquisition through Reels and TikTok. There is no measured audience, acquisition cost, or conversion result yet.
- Earlier budget is approximately USD 500 and owner time 10–15 hours weekly, with AI agents implementing/testing. Total-versus-monthly budget and included AI costs are still unspecified.

## Commercial design boundaries

Profit is an objective, not an assertion of a validated model. Favor visible prices, useful products, explicit reward eligibility, funded commitments, and rule changes that apply prospectively to new commitments. No proposal requires players to spend earned rewards instead of redeeming under published rules.

The owner has not explicitly approved the prior recommendation that all paid advantages/continues be restricted to a non-redeemable assisted mode. Keep that as an open decision, not a settled requirement. Likewise, the latest message is not blanket approval of hidden forced deaths, manipulated purchase odds, or undisclosed withholding near redemption.

Separate economy levers from physics. Economy controls published issuance, caps, catalog prices, funding/reservations, and promotional budgets. Core controls versioned simulation and verifies gameplay facts. Purchases must not silently rewrite an in-progress challenge or promised reward.

## Next deliverable: Game Design v0.1 and economy specification

### A. Core loop and pattern catalog

Specify tap response, gravity, death boundaries, safe restart, pause/background/reconnect, collection order, and score. Author a small pattern catalog: broad traversal, alternating heights, optional risky collectible path, recovery section, and clearly telegraphed temporary booster segment. Parameters are experimental until tested; never claim a pattern is feasible without validation.

Define supported boosters one at a time, including duration, stacking, collision effects, eligibility, and visual feedback. Cosmetic effects must remain separable from gameplay rules.

### B. Challenge identity and determinism

A seed alone is insufficient. A challenge descriptor must identify simulation version, generation version, configuration/pattern catalog, seed, difficulty schedule, mode, allowed loadout/boosters, continue policy, scoring rule, and reward policy where applicable. Pin the descriptor for the challenge lifetime.

Require identical simulation inputs and descriptors to produce identical collision, collection, and score outputs in TypeScript and Go. Separate random streams for world geometry, gameplay items, and visual-only decoration so a cosmetic cannot change a challenge. Store verified run evidence and explicit assisted status. Keep challenge IDs opaque and resolve descriptors server-side.

Shared seed means the same generated world under the same descriptor; it does not guarantee identical experiences with different loadouts. Either constrain loadouts or expose separate categories. Do not compare adaptive personal routes as identical fixed challenges.

For daily routes specify reset timezone, rules version, attempts, score selection, ties, reward qualification, duplicate prevention, and replay/automation protections. Daily return incentives do not imply a funded reward for every attempt.

### C. Economy model before redeemable issuance

Specify Feathers, GAME_STAR, and XTR separately. Map every source and sink to an owner, policy version, transaction, and unique business identity. Distinguish score, pending pickups, verified balances, available/reserved value, and provider assets.

Build an executable model with explicit assumptions for retained players, payer conversion, purchase sizes, realizable receipts, refunds, acquisition/infrastructure/AI/support costs, gift costs, abuse, and settlement timing. Simulate low-purchase/high-redemption and automated-player scenarios. Spent earned points are not new external revenue.

Acceptance: funded reward commitments are bounded; purchases are not required to unlock promised redemption; already credited claims survive death; retries cannot duplicate credits/spends; insufficient future funding pauses new commitments without erasing old ones. No public earning or profitability claim is supported until measured.

### D. Monetization mode decision

Compare two explicit policies before implementation: (1) equal gift-earning/ranked rules, with paid advantages only in assisted casual play; (2) paid modifiers in an eligible mode, requiring a fully specified funded policy, competition categories, abuse model, and review. Do not implement option (2) by default. Price and balance only after costs and pilot behavior are known.

### E. Small playable vertical slice

After the above contracts are reviewed, scaffold the agreed monorepo and build local TypeScript gameplay with test-first pure rules, placeholder art, seeded generation, collision/restart, and a bounded long-run test. Add a Go verifier with shared golden fixtures before implementing valuable rewards or challenge leaderboards. This prototype has no live payments or redeemable rewards and must be labeled accordingly.

Then connect Telegram identity, verified runs, durable rewards under an approved policy, friend challenges/daily leaderboards, direct cosmetic payments, and a controlled gift pilot in reviewable slices. Broader framework choices remain those of the existing ADRs; an ambiguous earlier stack agreement is not authority for a language migration.

## Early delivery acceptance

- Same descriptor and inputs agree across TypeScript and Go.
- Generation remains feasible under the declared physics and bounded over long runs.
- Challenge and daily scores distinguish incompatible rules/loadouts.
- Boosters have explicit effects and reward eligibility.
- Free restart and pause/reconnect have tested behavior.
- No real reward issuance or payment path is enabled by placeholder/prototype code.
- Owner evaluates gameplay on real Telegram mobile clients before presentation polish is treated as done.

## Decisions still needed before monetary design is finalized

1. Is USD 500 the total budget or a monthly budget, including or excluding AI subscriptions?
2. Exact launch countries and operator location.
3. Whether paid advantages can affect gift-earning runs; preferred baseline remains equal reward-bearing rules and a separate assisted category.
4. Initial gift selection and funded reward budget.

Art selection, failure-sharing, and broader live operations do not block pure-core work. Live earning, paid randomized items, and real gift delivery remain gated on the relevant unresolved decisions and verification.

## Current execution status

Decisions and delivery gates recorded only. No service, gameplay implementation, age verification, economy simulator, purchase, or provider gift operation has been implemented or executed by this update.

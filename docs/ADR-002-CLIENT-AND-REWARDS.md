# ADR-002 — Browser client, networking, and gift-reward clarification

Research checked: October 10, 2026, local MSK. Status: selected service shape, local TypeScript simulation + HTTP checkpoints, and Feathers + in-game Stars. Implementation/economic details remain proposed; nothing has been implemented or benchmarked. See ADR-003 for the supplied Telegram article and broker comparison.

## 1. Selected service shape

The owner's current direction is one frontend deployable with UI and browser game client; one gateway; and three backend services named **platform**, **core**, and **economy**. Platform and Economy remain Python; Core remains Go. Core is the renamed Game service in ADR-001, not an additional service.

The frontend is a static application with one bundle/build boundary, not separate shop/game services. The gateway routes one public origin to the appropriate backend and, if adopted, upgrades the Core WebSocket route. It contains no authoritative game, wallet, or purchase rules. Its implementation remains to be selected; a reverse proxy is preferred over a new bespoke business service.

The owner selected Telegram Star purchases, rewards fulfilled as Telegram gifts, and Feathers + Stars as the two internal currency names. Stars must be identified as in-game Stars, distinct from Telegram wallet/payment currency XTR. Target jurisdictions, age policy, budgets, and detailed redemption rules still require decisions.

## 2. Gifts are possible, but not equivalent to arbitrary Star withdrawals

The current Bot API documents `getAvailableGifts` and `sendGift`. Critically, `sendGift` explicitly states that its receiver cannot convert the gift to Telegram Stars. Its `pay_for_upgrade` option can make an upgrade free for the receiver; it does not remove the documented direct-conversion restriction.[1]

Telegram's general gifts API documents upgrades when an eligibility flag is set, collectible resale, and possible resale timing restrictions. General conversion is conditional and conversion value can be less than purchase price. These broader user/client features do not override the bot-sent-gift restriction.[2]

Therefore:

- Accept **gift redemption** as a proposed reward feature, not a proven automatic Stars cash-out route.
- Advertise the actual deliverable: the named gift. Do not promise direct conversion, a resale buyer, a fixed resale value, or immediate liquidity.
- Upgrade eligibility, availability, additional cost, recipient eligibility, resale rules, and any wait period must be checked for the selected gift. The bot can optionally fund an eligible upgrade, but that requires an explicit cost decision and live provider test.[1][2]
- Do not use automated personal Telegram accounts to evade the supported bot flow.
- Gift delivery remains a funded operator expense. Ledger issuance cannot create actual gifts or actual Telegram Stars.

### Selected currency names; economic policy still proposed

Two **internal** balances can be:

1. **Feathers:** soft progression currency for cosmetics and nonfinancial progression. No promised gift or cash redemption.
2. **In-game Stars:** the owner-selected name for the separately budgeted balance redeemable against a published gift catalog. Store as `GAME_STAR`, visibly distinguish it from Telegram Stars, and do not promise an automatic XTR exchange rate.

Actual **Telegram Stars (XTR)** are the external purchase/payment asset, not a balance the game can mint. This yields two internal currencies plus an external payment rail. Proposed visible disclosure: “In-game reward points, separate from your Telegram Stars balance. Redeem for gifts listed in this game.” Purchased-versus-earned value, rates, caps, and catalog prices still need a reviewed policy.

Economy owns issuance, caps, available/reserved balances, catalog pricing, and the pre-funded reward pool. Core emits verified gameplay facts; it does not invent payable amounts. Do not introduce sales of in-game Stars or earning multipliers before their economics and policy have been explicitly approved.

### Gift redemption workflow

1. Economy validates identity, eligibility, available credits, funding, and a current gift quote.
2. In a local transaction, reserve the credits and create one redemption intent with a stable business identifier.
3. Platform performs the authenticated Telegram gift operation on Economy's behalf; it owns the provider credentials and transport.
4. Record confirmed success, explicit failure, or an unknown outcome. Confirmed success settles the reservation; an explicit no-delivery failure releases it.
5. A network timeout after sending is **unknown**, not automatic failure. Reconcile or route to operator review rather than blindly sending another gift.

The documented `sendGift` contract returns a boolean and does not expose an application idempotency-key parameter. Thus an internal idempotency key alone cannot make remote gifting exactly-once. A provider-level delivery/reconciliation strategy, an ambiguity runbook, and a live test are release prerequisites.[1]

## 3. Separate the decisions being compared

| Layer | Question | Candidate choices |
| --- | --- | --- |
| UI shell | How do shop, wallet, menus, and profile render? | React, another DOM framework, plain DOM |
| Game rendering | How are duck, obstacles, particles, and scenery drawn? | Canvas 2D, PixiJS, Phaser |
| Simulation | Where and in what language do rules execute? | TypeScript locally; Go natively; optional Go WASM locally |
| Transport | How do browser and server exchange data? | HTTP/Fetch, WebSocket |
| Authority | Who accepts scores/rewards as valid? | Go Core, never unvalidated client totals |

WASM and WebSocket are not alternatives: one is a code-execution target, the other a network transport. A WASM client can use HTTP or WebSockets, and a TypeScript client can also use either.

## 4. Why Go WASM was proposed—and why it is not required

ADR-001 proposed Go WASM to reuse a pure Go simulation in both browser and Core, reducing duplicated rule implementations. Go documents a JavaScript/browser WebAssembly target.[8] That is a maintainability hypothesis, not evidence that this game needs more CPU performance.

Potential advantages: one simulation codebase; native server execution; shared versioned rules. Requirements still include browser/native parity checks, deterministic arithmetic, and separation from rendering and networking.

Costs to measure: download/startup, runtime memory, JS/WASM calls, debugging, build tooling, and Telegram WebView behavior. There are no measurements for this project yet. Go WASM also does not make a client trustworthy: distributed client code remains available to an attacker.

**Revised baseline recommendation:** plain TypeScript for the small browser simulation and Go for authoritative verification. Define fixed-step updates, fixed-point/integer arithmetic, explicit rounding/overflow/ranges, PRNG, collision order, and collectible order in a language-neutral specification. Feed identical seed/input vectors into both implementations; any divergence blocks CI. Cosmetic effects never change those rules.

WASM remains an optional comparison experiment if duplication becomes burdensome or measured device constraints support it. ADR-001's WASM-first recommendation is superseded by this baseline proposal.

## 5. HTTP versus WebSockets

Fetch is the browser's JavaScript interface for HTTP requests.[3] WebSockets provide two-way communication on a connection; the standard WebSocket interface lacks automatic backpressure, so the application must bound message queues and processing.[4]

| Approach | Proposed fit | Costs / risks to evaluate |
| --- | --- | --- |
| Local TS simulation + HTTP input checkpoints + Go verification | **Selected initial solo-game baseline** | Versioned cross-language rules; rewards pending until verified |
| Local TS prediction + WebSocket input batches/snapshots + Go authority | Choose for continuous corrections, live state, or later multiplayer | Reconnect, connection routing, bounded queues, sequence/resume, backpressure |
| Local Go WASM simulation + HTTP or WebSocket + Go authority | Choose if a measured reuse/device benefit justifies it | Runtime delivery and browser integration, parity testing remains |
| Server-only Go simulation + WebSocket, browser only draws | Not recommended without latency testing/prediction | Input feedback depends on the network; prediction introduces local simulation again |

WebSockets do not eliminate physics or drawing in the browser. They do not make valid bot-generated inputs human. HTTP checkpoints can verify ongoing play without a persistent socket; WebSockets can reduce interaction overhead and enable timely server pushes, but the actual latency/cost benefit must be measured for our traffic.

### Selected initial protocol

- Immediate local flap and rendering; never wait for a server response before showing the input.
- HTTP for authentication, run start, catalog, purchases, wallet, redemption status, and leaderboard.
- Bounded ordered input batches/checkpoints during play and finalization. Interval and maximum batch size are configuration to choose through testing, not fixed conclusions of this research.
- Core advances its own last accepted state; it never accepts the client position, collision outcome, or reward total as authority.
- Infinite rounds use incremental generation, bounded live objects, state rebasing, and compacted accepted input prefixes.
- A bounded reconnect/resume policy; provisional rewards remain pending. A lost network does not erase already committed earnings.
- Keep input/checkpoint contracts independent of HTTP framing so a future WebSocket adapter can reuse validation and state transitions.

If WebSockets are chosen initially, keep HTTP for non-real-time business APIs, use WSS through Gateway directly to Core, authenticate the session, enforce origin/authorization, bound frame sizes and queue depth, and require sequence/ack/resume semantics. Do not replay inputs twice after reconnect. Explicitly define pause, background, timeout, and reward states.

## 6. What does “Go HTTP client” mean?

**Browser talking to a Go HTTP server:** yes; recommended. TypeScript `fetch()` calls Core's Go endpoints through Gateway. There is no requirement that client and server use the same language.[3]

**A client written in Go and running natively:** that would be another application, not the standard browser Mini App selected here. If compiled to browser WASM, it returns to the WASM delivery choice. Go's `js/wasm` HTTP transport itself calls the JavaScript `fetch` API; it is not a way around the browser networking/runtime model.[9]

**Go server-to-server HTTP client:** appropriate for internal backend request/response calls, but does not implement the browser UI.

## 7. Renderer / UI alternatives

| Choice | Verified capability | Assessment for Doofy Duck |
| --- | --- | --- |
| Canvas 2D + TS + React shell | Native JavaScript canvas drawing supports animations and game graphics.[5] | Simplest rendering primitive for a small scene; we own sprite/asset/input plumbing. Strong fallback choice if minimal dependencies win. |
| PixiJS + TS + React shell | PixiJS v8 documents WebGL/WebGPU renderers, recommending WebGL for production; its current renderer guide lists Canvas fallback as coming soon.[6] | **Preferred with the planned skins/effects**, while retaining an independent simulation. Verify WebGL support/context loss; do not assume automatic Canvas fallback. |
| Phaser + React shell | Browser-oriented 2D framework; JavaScript/TypeScript; WebGL and Canvas rendering.[7] | Credible if built-in game systems/editor workflow become important. Do not make Phaser's physics the unreviewed authority while Core uses different rules. |
| Plain DOM/CSS or another UI shell | Alternative project organization rather than a change in server authority | Possible, but no current requirement justifies replacing the already accepted React shell. Use DOM UI for accessibility; avoid moving every simulated object through app state. |

React can coordinate an external animation/game system through its effects/lifecycle; its documentation explicitly discusses extracting coordinated animation logic outside React.[10] Keep the simulation/ticker outside per-frame React state. Mount/unmount must correctly clean up input handlers, animation loops, GPU assets, and network resources.

No renderer has been benchmarked here. Do not assert that PixiJS, Canvas, or Phaser is categorically fastest. Do not migrate frameworks because the backend language changed.

## 8. Recommendation and verification plan

Selected client approach: TypeScript simulation with authoritative **Go Core** verification and HTTP input checkpoints initially. Retain the proposed **React + Vite + TypeScript + PixiJS/WebGL** stack; a WebSocket adapter is optional, not an initial requirement. Platform/Economy remain Python. Keep one frontend deployable and Gateway as the edge routing component.

Before implementation locks this decision, agree device/network/startup criteria and, if useful, run disposable comparisons:

- TS/Pixi versus TS/Canvas under the same scenes/assets.
- TS versus Go WASM simulation under identical seeded runs.
- HTTP checkpoints versus WebSocket batches under latency, interruption, backgrounding, and reconnect.
- Gift fulfillment with a selected eligible gift: actual receipt, available recipient actions, cost, upgrade behavior, and recovery from ambiguous transport outcomes.

No performance figures or payout success are claimed. Experiments require explicit scope; production behavior remains TDD. Mandatory acceptance includes native/browser parity, bounded long runs, no duplicate credit, no unvalidated wallet totals, and no false gift-conversion claim.

## 9. State after this update

Recorded: the selected deployable shape and Core name, fresh primary-source research, a revised optional-WASM decision, client/transport comparison, and proposed gift/currency boundaries. Updated ADR-001 pointers to the newer decisions.

Not done: frontend/service code, Go WASM or WebSocket prototypes, benchmarks, actual Telegram gift transactions, CI deployment, or approval of detailed earning/redemption economics. Full automatic Star withdrawal remains unproven and is not what `sendGift` provides.

## Sources

[1] https://core.telegram.org/bots/api
[2] https://core.telegram.org/api/gifts
[3] https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
[4] https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
[5] https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
[6] https://pixijs.com/8.x/guides/components/renderers
[7] https://docs.phaser.io/phaser/getting-started/what-is-phaser
[8] https://go.dev/wiki/WebAssembly
[9] https://go.dev/src/net/http/roundtrip_js.go
[10] https://react.dev/learn/reusing-logic-with-custom-hooks

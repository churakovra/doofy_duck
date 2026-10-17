# ADR-002 — Browser client, verification, and later gifts

Status: selected future client/verification direction. Local TypeScript and Go
simulations exist; authentication, checkpoints, payments, and gift delivery services
do not. [Product vision](PRODUCT_VISION.md) owns audience, scope, and economy intent.

## Client and verification

Use one React/Vite/PixiJS frontend with a pure TypeScript simulation. Inputs have
immediate local feedback; no network round trip is needed for each flap. Go Core
will authoritatively verify bounded, ordered input checkpoints through HTTP.
The client must not supply authoritative positions, scores, or currency balances.

Pin simulation/generation/config identities for a run. Cross-language fixtures
must agree on integer arithmetic, PRNG, collision, collection, and event order.
Rendering and cosmetics cannot change authoritative outcomes. Keep live world,
input, and transport buffers bounded.

Define authentication, sequence/deduplication, pause, reconnect, finalization, and
continue authorization before implementing the service. The first public version
allows one paid continue per run; its exact safe-resume behavior remains open.
Server verification proves rule-consistent inputs, not human participation.

Use HTTP for identity, run startup, checkpoints, catalog, purchases, and balances.
Gift status and leaderboards are later endpoints, not first-release requirements.
WebSockets and Go WASM are not initial requirements. Keep transport framing
separate from verification so it can evolve without rewriting simulation rules.

## Currency and payment boundaries

Coins and in-game Stars are internal units. Existing `FEATHER` and `GAME_STAR`
identifiers remain unchanged until a separately designed migration. XTR is the
external Telegram Stars payment asset. No internal balance implies Telegram wallet
credit, a 1:1 conversion, or a current gift entitlement.

Economy owns issuance, prices, ledger, inventory, payment business state, and later
reward eligibility/funding. Core emits verified death/cap completion facts; checkpoints never credit currency during flight. Account issuance stays disabled until earning rules are approved. Platform owns
Telegram credentials and provider transport. Detailed paid products and rates
still require specification. See [service ownership](ADR-001-MICROSERVICES.md).

## Later gift exchange

Gift exchange is excluded from the first public release. A future catalog must
name the actual deliverable and publish eligibility, earning limits, prices, and
funding rules before creating commitments. Players can qualify without purchases;
fulfilled conditions must be honored without retrospective threshold changes.

The checked Telegram `sendGift` contract states that the recipient cannot convert
the bot-sent gift to Telegram Stars.[1] Do not advertise Stars withdrawal, automatic
conversion, guaranteed resale, or liquidity. Verify the selected gift's actual
availability and recipient behavior before launch.

Proposed fulfillment:

1. Economy validates eligibility, available credits, funding, and the gift quote.
2. Reserve credits and create a durable redemption intent with a stable identity.
3. Platform attempts authenticated provider delivery on Economy's behalf.
4. Confirmed success settles the reservation; explicit no-delivery failure releases
   it. An ambiguous timeout remains unknown and requires reconciliation or review.

An internal deduplication key does not guarantee exactly-once external gifting.
The checked `sendGift` API exposes no application idempotency-key parameter.[1]
Do not blindly retry an unknown delivery. Live delivery tests and a reconciliation
runbook are prerequisites to enabling gifts.

## Required validation

Current local checks are in the [root README](../README.md). Before commercial
release, add real authentication/authorization, checkpoint and continue lifecycle,
payment/refund, durable fulfillment, and abuse tests. Validate selected real
Telegram mobile clients and device performance. Before gifts, also validate
funding, eligibility, actual receipt, and ambiguous delivery recovery.

## Sources

[1] https://core.telegram.org/bots/api#sendgift
[2] https://core.telegram.org/bots/payments-stars
[3] https://core.telegram.org/bots/webapps

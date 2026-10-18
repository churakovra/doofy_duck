# Doofy Duck — product vision

Status: owner-approved product direction, October 14, 2026. This is the single
current source of product intent and commercial-release scope. It does not report
implemented features, release acceptance, or a validated business model.

## Purpose and audience

Build an enjoyable, commercially sustainable single-tap arcade game inside a
Telegram Mini App. Players guide an original duck between generated pipe pairs,
improve their score, collect currency, and customize their duck and environment.
The reference is Flappy Bird's flight loop; the project name is **Doofy Duck**.

The intended audience is **18+**. The first public version supports **Russian and
English**. Launch countries and age-eligibility controls remain unresolved; an
18+ declaration alone is not evidence of verified eligibility.

The business goal is sustainable profit from voluntary purchases after operating
costs and, later, funded rewards. Audience acquisition will use Reels and TikTok
showing development. No audience size, retention, revenue, or profitability is
established yet.

## Game loop and difficulty

Start a run → tap to fly → pass pipes for score → choose whether to risk collecting
items → die or optionally continue once → keep collected currency → customize or
start another free run. Skins and backgrounds change appearance, not hitboxes or
physics; backgrounds are cosmetic worlds, not separate gameplay maps.

The target game is challenging. Difficulty rises in steps, with a different,
unpredictable sequence of challenges between runs and room for recovery. Each
transition must leave a physically achievable route and time to react under the
actual physics. Exact difficulty parameters require testing and playtesting.
There is no hidden forced death or difficulty adjustment based on purchases,
wallet balance, or proximity to a record or gift.

Randomness may defeat simple repeated-input scripts; it is not bot protection.
Server-authoritative run verification, payment protection, issuance limits, and
automation detection are separate commercial requirements. A reproducible valid
run does not prove that a human played it.

## First public version

- A Telegram Mini App with the flight game, score, varied challenges, free new
  runs, and saved player progress.
- Two internal currencies: **coins** for ordinary progression and **in-game
  Stars** for more valuable purchases. Actual Telegram Stars (**XTR**) are the
  external payment asset, visibly separate from both game balances.
- Owned/equipped skins and backgrounds, with a shop offering a specific item at
  a visible price. Actual Telegram Stars purchases are part of this release;
  products, prices, and fulfillment details still need specification.
- At most **one continue per run**, purchased with in-game Stars, preserving the
  score. Its price and safe-resume behavior require a separate design. Starting
  a new run is free; collected currency is not held hostage to a continue.
- Russian and English player-facing text.

Real gift redemption, loot boxes, leaderboards, friend invitations/challenges,
and abilities/boosters are excluded from this first public version. Do not
advertise it as an already working way to earn external rewards.

## Economy and later rewards

Internal Stars are not Telegram wallet Stars. There is no approved 1:1 conversion
or guaranteed withdrawal to a Telegram account. “One or two Stars per run” is an
initial balancing hypothesis, not a promised earning rate. The product calls its ordinary currency coins; existing `FEATHER` and `GAME_STAR`
simulation identifiers and stored balances are unchanged.

Encourage voluntary spending through desirable products and clear prices.
Purchases and currency issuance must have a sustainable economic model; spending
earned currency is not new external revenue. Pricing, conversion rates, reward
budgets, and purchase-versus-earned balance rules remain open.

Later, eligible players may exchange accumulated points for **specified Telegram
gifts** under published, funded rules. Players must be able to qualify without
a purchase. Once published conditions are met, honor the promised reward; do not
add a payment requirement or move the threshold retroactively. Bound new
commitments in advance by the funded reward budget.

The checked Bot API `sendGift` contract says its recipient cannot convert that
gift to Telegram Stars. Gift delivery must not be described as Stars withdrawal.
The selected gift, availability, delivery, and recipient behavior need verification
before launch. See [Telegram's method contract](https://core.telegram.org/bots/api#sendgift)
and the [technical reward research](ADR-002-CLIENT-AND-REWARDS.md).

## Future development and open decisions

Later candidates: funded gift exchange, leaderboards, voluntary friend sharing
and challenges, containers, magnets, temporary abilities, and starting boosters.
These are directions, not approved detailed mechanics. Daily routes remain an
unconfirmed idea. No earlier visual concept is accepted as the final art style.

Before commercial implementation/release, specify prices and currency rates,
difficulty parameters, budget, launch countries, age checks, final visual style,
payment/continue behavior, and operational protection against abuse. Before gift
release, additionally specify the actual gifts, earning/eligibility rules, funding,
and reliable fulfillment. No numeric economics or service deployment is approved
by this vision alone.

Success is evaluated through voluntary replay, retention, purchases, profit after
costs, and correct fulfillment of payments and future rewards. Set numeric targets
after a pilot; low redemption alone is not a success criterion.

## Current implementation and document authority

The repository currently contains one account-backed React/PixiJS game, a pure
TypeScript simulation and matching native Go simulation, Telegram account/session
services, verified runs, wallet settlement and a cosmetic shop. Local startup uses
a persistent development Telegram identity and PostgreSQL; production requires
real Telegram sign-in. There is no anonymous practice mode. Browser-only balances
are never imported into account wallets. Payments, paid continues and gift
redemption remain unimplemented. Local difficulty uses seeded stepped challenge
families and recovery sections alongside a speed ramp. Tuning, production economy
activation, hosted acceptance and real-device evidence remain separate work.

[Current simulation rules](ARCADE_SIMULATION.md) describe what runs today.
This vision defines the commercial target; current local implementation limits
are not exclusions from that target. Technical ADRs describe the selected future
architecture and unresolved engineering proposals. See the
[documentation map](README.md).

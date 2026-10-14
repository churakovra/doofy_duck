# ADR-003 — In-game Stars, HTTP checkpoints, and broker choice

Status: currency names and HTTP client approach selected by the owner; broker recommendation awaiting approval. Provider behavior researched, not tested through a real gift transaction.

## Selected product/client decisions

- One frontend + Gateway + Platform/Core/Economy remain the chosen deployment shape.
- Use local TypeScript simulation and HTTP input checkpoints with authoritative Go Core verification. Go WASM and gameplay WebSockets are not initial requirements. Keep renderer and simulation independent; retain the proposed React/Vite/PixiJS frontend.
- The two internal currency names are **Feathers** and **Stars**. Internally, store the latter as `GAME_STAR`, distinct from provider payment currency `XTR`.
- The reward action is **Redeem a gift**, not **Withdraw Telegram Stars**.

The UI may use Stars as requested, but must identify them visibly as **in-game Stars**. Proposed wallet/redemption disclosure: “In-game reward points, separate from your Telegram Stars balance. Redeem for gifts listed in this game.” Do not imply that a game ledger entry exists in Telegram's wallet, automatically transfers to it, or has an approved fixed XTR exchange rate. Catalog prices, funding, earning rates/caps, purchased versus earned value, and gift eligibility remain to be specified.

## The supplied Telegram article versus the Bot API

The exact supplied article, `https://telegram.org/blog/gifts-verification-platform/ru?ln=a`, is dated **October 5, 2024**. It describes users sending gifts to each other and the recipient being able to exchange a gift for part of its price in Stars.[1]

The current Bot API method **sendGift** separately states that the recipient cannot convert a bot-sent gift into Telegram Stars.[2]

These describe different sending paths. The blog is evidence that general user gift conversion exists; it is not evidence that the same feature is available for gifts sent through this bot method. Follow the specific provider method contract for our implementation. Do not promise conversion or guaranteed resale. A selected gift and its permitted recipient actions must be checked in a real controlled provider test before launch.

This does not block gift redemption itself, but limits the promise to delivery of the specified gift. Gifts consume actual operator resources; issuing internal Stars does not fund them. The reservation, unknown-outcome, and reconciliation rules in ADR-002 still apply.

## Does NATS JetStream cost money?

NATS Server uses Apache License 2.0, with a no-charge, royalty-free grant. There is no NATS Server software licensing fee merely to self-host it, including its JetStream persistence functionality; comply with the license terms.[3][4]

That is not zero operating cost: compute, persistent storage, replication where required, networking, monitoring, recovery, security maintenance, and operator time must be budgeted. A managed hosting/support contract, if chosen, has its own pricing. No cloud quote or monthly estimate has been obtained for this project.

JetStream provides durable messages, replay, and at-least-once delivery; application consumers must still account for redelivery.[4] It was proposed for those capabilities, not because the architecture requires NATS.

## Broker comparison

| Option | Documented model | Assessment for current requirements |
| --- | --- | --- |
| NATS JetStream | Persistent messages with replay and at-least-once delivery.[4] | Viable; introduces an unfamiliar tool for this owner. Not required. |
| RabbitMQ | Explicit work-queue patterns, consumer acknowledgments, and publisher confirms.[6][7] | **Recommended** for the initial inter-service events and background work. Aligns with the owner's interest in technologies encountered in backend positions. |
| Apache Kafka | Retained, partitioned event streams, independently readable/replayable by consumers; streaming/integration use cases.[9] | Reconsider when event retention, multiple downstream pipelines, or streaming analytics justify that model. Not the preferred initial task broker here. |

RabbitMQ server/core plugins are licensed under MPL 2.0; its license notice also identifies some Apache-licensed files. Self-hosted open-source software and commercial hosting/support offerings must not be conflated.[5]

The job advertisements the owner has seen are a useful personal learning criterion, not a measured market-share result. No labor-market survey or comparative performance benchmark was performed. A familiar tool is reasonable, but provider reliability rules still need engineering.

## Proposed RabbitMQ integration

Core and Platform retain their own PostgreSQL transactional outboxes. Publishers use confirms and retry unconfirmed publication safely using stable business event identifiers. Consumers persist deduplication and business state together before acknowledging a delivery. RabbitMQ documents publisher confirms and consumer acknowledgments as separate mechanisms.[7]

Use durable queues with an explicitly chosen availability model; quorum queues provide a durable replicated design for requirements needing replication.[8] A local development broker is not evidence of production high availability.

Example domains:

- `core.run_segment_verified.v1` → Economy validates eligibility and credits `GAME_STAR`/Feathers according to versioned policy.
- `platform.payment_received.v1` → Economy validates and records payment/fulfillment.
- A separately typed redemption command → Platform attempts authorized gift delivery and reports success, failure, or unknown outcome.

Commands request work; events record facts. Use explicit versioned JSON schemas, independent service authorization, bounded retries/backoff, a dead-letter/review path, and correlation identifiers. Multiple services needing a fact receive independent queues bound to that event route rather than accidentally competing for one delivery.

Exactly-once application effects require business deduplication and correct local transactions. Broker delivery guarantees do not make Telegram gift side effects exactly-once. Never blindly resend a gift after an ambiguous provider timeout; reconcile or require operator review.

## Approval and verification status

Accepted: Feathers + in-game Stars, gift-redemption wording, local TypeScript simulation + HTTP checkpoints. Proposed: RabbitMQ replacing the earlier JetStream candidate, queue topology, production availability/resources, and exact currency/redemption economics.

Written: refreshed source-backed comparison and updated selected-client/currency notes. Not executed: broker deployment, framework integration, gift sending/conversion, load tests, cloud cost estimate, or production CI.

## Sources

[1] https://telegram.org/blog/gifts-verification-platform/ru?ln=a
[2] https://core.telegram.org/bots/api
[3] https://raw.githubusercontent.com/nats-io/nats-server/main/LICENSE
[4] https://docs.nats.io/concepts/jetstream
[5] https://raw.githubusercontent.com/rabbitmq/rabbitmq-server/main/LICENSE
[6] https://www.rabbitmq.com/tutorials/tutorial-two-python
[7] https://www.rabbitmq.com/docs/confirms
[8] https://www.rabbitmq.com/docs/quorum-queues
[9] https://kafka.apache.org/intro

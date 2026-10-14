# ADR-003 — Currency names and proposed broker

Status: coins + in-game Stars and HTTP checkpoints are selected. RabbitMQ is a
recommendation awaiting approval; no broker or commercial services are deployed.
[Product vision](PRODUCT_VISION.md) owns product scope and economic decisions.

## Currency names

The product uses **coins** and **in-game Stars**, visibly separate from actual
Telegram Stars (**XTR**). Current code retains `FEATHER` and `GAME_STAR`; this
product naming decision does not migrate code, stored data, or event schemas.
There is no approved 1:1 exchange rate or Telegram Stars withdrawal promise.

Gift exchange is later work. Once enabled, its action should describe redemption
of a specified gift under published funded rules. First-release wording must not
imply an active gift catalog. See [client and reward boundaries](ADR-002-CLIENT-AND-REWARDS.md).

## Broker recommendation

Recommend RabbitMQ for durable inter-service work and events, aligned with the
owner's learning preference. Selection, topology, availability, and operating
budget remain open. A self-hosted license does not eliminate hosting, storage,
monitoring, recovery, or maintenance costs. No cost quote or benchmark is approved.

Core and Platform need transactional outboxes. Publishers use confirmations and
stable business identities; consumers atomically store deduplication and domain
updates before acknowledgment. Durable messaging does not make remote Telegram
side effects exactly-once. Bound retries, expose unknown outcomes, and reconcile.

Proposed event domains: verified run facts from Core, authenticated payment facts
from Platform, and later gift-delivery requests/results. These are design domains,
not existing wire schemas. Commands request work; events record facts. Multiple
services consuming one fact need independent queues rather than competing for a
single delivery. Define versioned schemas, producer authorization, correlation,
backoff, and operator review before deployment.

RabbitMQ documents publisher confirms and consumer acknowledgments separately.[1]
Quorum queues are an available replicated queue design, not an approved deployment
topology for this project.[2]

## Sources

[1] https://www.rabbitmq.com/docs/confirms
[2] https://www.rabbitmq.com/docs/quorum-queues

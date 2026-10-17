# ADR-003 — Currency names and durable delivery

Status: currency names and HTTP checkpoints are selected. Authenticated HTTP
outbox/inbox delivery is approved as of October 17, 2026; RabbitMQ is deferred.
Hosted acceptance remains separate.

## Currency boundaries

Use **coins** and **in-game Stars**, separate from actual Telegram Stars (**XTR**).
Preserve `FEATHER` and `GAME_STAR` identifiers. Local practice funds never become
account funds. No 1:1 conversion or withdrawal is approved; gifts remain later work.

Account issuance remains disabled until eligibility, rates, caps and spending rules
are approved. Verified gameplay facts are not spendable balances. See the
[product vision](PRODUCT_VISION.md) and [economy specifications](MVP_SPECIFICATIONS.md).

## Initial delivery

Core records completion evidence and an outbox entry in one transaction. A bounded
retry worker sends the immutable fact to Python's authenticated inbox. The receiver
commits event-ID and run/life business deduplication with evidence before success.
Identical retries return the prior outcome; conflicting payloads fail visibly.

Retry state, worker claims and outcomes must be durable. Expose pending delivery
separately from gameplay verification. Client claims cannot authorize account credit.

Introduce RabbitMQ only for measured throughput/routing needs. It still requires
transactional outbox/inbox, retries and deduplication. This decision approves neither
a broker deployment nor payment-provider behavior. See
[service ownership](ADR-001-MICROSERVICES.md) and the
[backend implementation record](BACKEND_FOUNDATION.md).

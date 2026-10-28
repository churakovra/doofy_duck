from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, case, cast, func, literal, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.economy.models import CompletionEvidence, CompletionSettlement, RunRewardCap
from app.economy.wallet.ledger import WalletError, post_entry
from app.economy.wallet.models import Wallet, WalletCurrency
from app.settings import Settings

POLICY_VERSION = "verified-pickups-v1"
STAR_POLICY_VERSION = "verified-pickups-v2-stars"
HISTORICAL_STAR_POLICY_VERSION = "verified-pickups-v2-historical-coins"
WETLAND_POLICY_VERSION = "verified-pickups-v3-wetland"
VARIED_OBSTACLE_POLICY_VERSION = "verified-pickups-v4-varied-obstacles"
PAIRED_ROUTES_POLICY_VERSION = "verified-pickups-v5-paired-routes"
CURRENCY_FORMATIONS_POLICY_VERSION = "verified-pickups-v6-currency-formations"
COIN_COURSE_POLICY_VERSION = "verified-pickups-v7-coin-course"
BONUS_SEGMENTS_POLICY_VERSION = "verified-pickups-v8-bonus-segments"
CURVED_PIPES_POLICY_VERSION = "verified-pickups-v15-curved-pipes"
VARIED_BASE_POLICY_VERSION = "verified-pickups-v14-varied-base"
BASE_BONUS_POLICY_VERSION = "verified-pickups-v13-base-bonus"
DENSE_PIPES_POLICY_VERSION = "verified-pickups-v12-dense-pipes"
PRESSURE_PIPES_POLICY_VERSION = "verified-pickups-v11-pressure-pipes"
VARIED_PIPES_POLICY_VERSION = "verified-pickups-v10-varied-pipes"
BONUS_SEGMENTS_V2_POLICY_VERSION = "verified-pickups-v9-bonus-segments-v2"
COIN_RUN_CAP = 30
SUPPORTED_SIMULATION_IDENTITY = ("1.3.0", "1.2.0", "dd-v1-stepped-v1")
STAR_SIMULATION_IDENTITY = ("1.4.0", "1.3.0", "dd-v1-star-interval-v1")
WETLAND_SIMULATION_IDENTITY = ("2.0.0", "2.0.0", "dd-v2-wetland-v1")
VARIED_OBSTACLE_SIMULATION_IDENTITY = ("2.1.0", "2.1.0", "dd-v2-varied-obstacles-v1")
PAIRED_ROUTES_SIMULATION_IDENTITY = ("2.2.0", "2.2.0", "dd-v2-paired-routes-v1")
CURRENCY_FORMATIONS_SIMULATION_IDENTITY = ("2.3.0", "2.3.0", "dd-v2-currency-formations-v1")
COIN_COURSE_SIMULATION_IDENTITY = ("2.4.0", "2.4.0", "dd-v2-coin-course-v1")
BONUS_SEGMENTS_SIMULATION_IDENTITY = ("2.5.0", "2.5.0", "dd-v2-bonus-segments-v1")
CURVED_PIPES_SIMULATION_IDENTITY = ("3.2.0", "3.2.0", "dd-v3-curved-pipes-v1")
VARIED_BASE_SIMULATION_IDENTITY = ("3.1.0", "3.1.0", "dd-v3-varied-base-v1")
BASE_BONUS_SIMULATION_IDENTITY = ("3.0.0", "3.0.0", "dd-v3-base-bonus-v1")
DENSE_PIPES_SIMULATION_IDENTITY = ("2.9.0", "2.9.0", "dd-v2-dense-pipes-v1")
PRESSURE_PIPES_SIMULATION_IDENTITY = ("2.8.0", "2.8.0", "dd-v2-pressure-pipes-v1")
VARIED_PIPES_SIMULATION_IDENTITY = ("2.7.0", "2.7.0", "dd-v2-varied-pipes-v1")
BONUS_SEGMENTS_V2_SIMULATION_IDENTITY = ("2.6.0", "2.6.0", "dd-v2-bonus-segments-v2")
SUPPORTED_SIMULATION_IDENTITIES = {
    SUPPORTED_SIMULATION_IDENTITY: POLICY_VERSION,
    STAR_SIMULATION_IDENTITY: STAR_POLICY_VERSION,
    WETLAND_SIMULATION_IDENTITY: WETLAND_POLICY_VERSION,
    VARIED_OBSTACLE_SIMULATION_IDENTITY: VARIED_OBSTACLE_POLICY_VERSION,
    PAIRED_ROUTES_SIMULATION_IDENTITY: PAIRED_ROUTES_POLICY_VERSION,
    CURRENCY_FORMATIONS_SIMULATION_IDENTITY: CURRENCY_FORMATIONS_POLICY_VERSION,
    COIN_COURSE_SIMULATION_IDENTITY: COIN_COURSE_POLICY_VERSION,
    BONUS_SEGMENTS_SIMULATION_IDENTITY: BONUS_SEGMENTS_POLICY_VERSION,
    BONUS_SEGMENTS_V2_SIMULATION_IDENTITY: BONUS_SEGMENTS_V2_POLICY_VERSION,
    CURVED_PIPES_SIMULATION_IDENTITY: CURVED_PIPES_POLICY_VERSION,
    VARIED_BASE_SIMULATION_IDENTITY: VARIED_BASE_POLICY_VERSION,
    BASE_BONUS_SIMULATION_IDENTITY: BASE_BONUS_POLICY_VERSION,
    DENSE_PIPES_SIMULATION_IDENTITY: DENSE_PIPES_POLICY_VERSION,
    PRESSURE_PIPES_SIMULATION_IDENTITY: PRESSURE_PIPES_POLICY_VERSION,
    VARIED_PIPES_SIMULATION_IDENTITY: VARIED_PIPES_POLICY_VERSION,
}
HISTORICAL_SIMULATION_IDENTITIES = {
    SUPPORTED_SIMULATION_IDENTITY,
    STAR_SIMULATION_IDENTITY,
}
TERMINAL_STATUSES = ("committed", "ineligible")


@dataclass(frozen=True)
class BackfillPlan:
    completion_count: int
    run_count: int
    feathers_to_credit: int
    game_stars_to_credit: int
    unsupported_count: int
    waiting_count: int
    has_more: bool
    next_cursor: tuple[UUID, int] | None


@dataclass(frozen=True)
class BackfillResult:
    completions_considered: int
    feathers_credited: int
    game_stars_credited: int
    unsupported_count: int
    waiting_count: int
    has_more: bool
    next_cursor: tuple[UUID, int] | None


@dataclass(frozen=True)
class RetryFailureResult:
    requeued: int
    has_more: bool
    next_cursor: tuple[UUID, int] | None


def enqueue_settlement(session: Session, evidence: CompletionEvidence, settings: Settings) -> None:
    session.execute(
        insert(CompletionSettlement)
        .values(
            id=uuid4(),
            event_id=evidence.event_id,
            run_id=evidence.run_id,
            life_index=evidence.life_index,
            account_id=UUID(str(evidence.payload["account_id"])),
            status="pending",
            reason=_initial_reason(evidence, settings),
            feathers_credited=0,
            stars_credited=0,
            completed_at=_payload_completed_at(evidence.payload),
        )
        .on_conflict_do_nothing(index_elements=[CompletionSettlement.run_id, CompletionSettlement.life_index])
    )


def process_settlement_batch(session: Session, *, settings: Settings, limit: int = 100) -> int:
    """Settle up to limit facts and return the count moved out of pending."""
    settings.validate_settlement_config()
    if type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError("limit must be an integer from 1 to 500")
    cutoff = settings.economy_settlement_activated_at
    if not settings.economy_settlement_enabled or cutoff is None:
        return 0

    prior_life = CompletionSettlement.__table__.alias("prior_life")
    prior_terminal_count = (
        select(func.count())
        .select_from(prior_life)
        .where(
            prior_life.c.run_id == CompletionSettlement.run_id,
            prior_life.c.life_index < CompletionSettlement.life_index,
            prior_life.c.status.in_(TERMINAL_STATUSES),
        )
        .correlate(CompletionSettlement)
        .scalar_subquery()
    )
    ready_first = or_(CompletionSettlement.life_index == 0, prior_terminal_count == CompletionSettlement.life_index)
    statement = (
        select(CompletionSettlement, CompletionEvidence)
        .join(CompletionEvidence, CompletionEvidence.event_id == CompletionSettlement.event_id)
        .where(CompletionSettlement.status == "pending", CompletionSettlement.completed_at >= cutoff)
        .order_by(case((ready_first, 0), else_=1), CompletionSettlement.run_id, CompletionSettlement.life_index)
        .limit(limit)
        .with_for_update(skip_locked=True, of=CompletionSettlement)
    )
    rows = [(settlement, evidence) for settlement, evidence in session.execute(statement).all()]
    _lock_live_batch_resources(session, rows)
    for settlement, evidence in rows:
        _process_live_settlement(session, settlement, evidence)
    return settlement_batch_progress(settlement.status for settlement, _evidence in rows)


def retry_supported_failures(
    session: Session,
    *,
    settings: Settings,
    limit: int = 100,
    after: tuple[UUID, int] | None = None,
) -> RetryFailureResult:
    """Requeue one bounded page of post-activation failures supported by this code version."""
    settings.validate_settlement_config()
    if type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError("limit must be an integer from 1 to 500")
    _validate_backfill_cursor(after)
    cutoff = settings.economy_settlement_activated_at
    if not settings.economy_settlement_enabled or cutoff is None:
        raise ValueError("retrying settlements requires enabled settlement and an activation timestamp")
    statement = (
        select(CompletionSettlement)
        .join(CompletionEvidence, CompletionEvidence.event_id == CompletionSettlement.event_id)
        .where(
            CompletionSettlement.status == "actionable_failure",
            CompletionSettlement.completed_at >= cutoff,
            or_(
                *[
                    (
                        (CompletionEvidence.payload["simulation_version"].as_string() == identity[0])
                        & (CompletionEvidence.payload["generator_version"].as_string() == identity[1])
                        & (CompletionEvidence.payload["config_id"].as_string() == identity[2])
                    )
                    for identity in SUPPORTED_SIMULATION_IDENTITIES
                ]
            ),
        )
        .order_by(CompletionSettlement.run_id, CompletionSettlement.life_index)
        .limit(limit + 1)
        .with_for_update(skip_locked=True, of=CompletionSettlement)
    )
    if after is not None:
        statement = statement.where(
            tuple_(CompletionSettlement.run_id, CompletionSettlement.life_index)
            > tuple_(literal(after[0]), literal(after[1]))
        )
    rows = session.scalars(statement).all()
    has_more = len(rows) > limit
    visible = rows[:limit]
    for settlement in visible:
        settlement.status = "pending"
        settlement.reason = "awaiting_settlement"
        settlement.settled_at = None
    return RetryFailureResult(
        requeued=len(visible),
        has_more=has_more,
        next_cursor=(visible[-1].run_id, visible[-1].life_index) if has_more and visible else None,
    )


def _process_live_settlement(session: Session, settlement: CompletionSettlement, evidence: CompletionEvidence) -> None:
    if not _prior_lives_are_settled(session, settlement):
        settlement.reason = "waiting_for_prior_life"
        return

    identity = _simulation_identity(evidence.payload)
    policy_version = SUPPORTED_SIMULATION_IDENTITIES.get(identity)
    if policy_version is None:
        settlement.status = "actionable_failure"
        settlement.reason = "unsupported_simulation_identity"
        settlement.settled_at = datetime.now(UTC)
        return

    cap = _lock_run_cap(session, settlement.run_id, settlement.account_id)
    collections = evidence.payload["collections"]
    rewards = settlement_rewards(
        identity,
        feathers=int(collections[WalletCurrency.FEATHER.value]),
        game_stars=int(collections[WalletCurrency.GAME_STAR.value]),
        feathers_remaining=COIN_RUN_CAP - cap.feathers_credited,
    )
    if rewards is None:
        raise RuntimeError("supported simulation identity lost its settlement policy")
    feathers, game_stars = rewards
    try:
        with session.begin_nested():
            _credit_completion(
                session,
                settlement=settlement,
                currency=WalletCurrency.FEATHER,
                amount=feathers,
                source_reference=str(settlement.event_id),
                policy_version=policy_version,
            )
            _credit_completion(
                session,
                settlement=settlement,
                currency=WalletCurrency.GAME_STAR,
                amount=game_stars,
                source_reference=str(settlement.event_id),
                policy_version=policy_version,
            )
    except WalletError:
        settlement.status = "actionable_failure"
        settlement.reason = "wallet_posting_failed"
        settlement.settled_at = datetime.now(UTC)
        return

    cap.feathers_credited += feathers
    cap.updated_at = func.now()
    settlement.feathers_credited = feathers
    settlement.stars_credited = game_stars
    settlement.policy_version = policy_version
    settlement.status = "committed"
    settlement.reason = (
        "legacy_star_generation"
        if identity == SUPPORTED_SIMULATION_IDENTITY and int(collections[WalletCurrency.GAME_STAR.value])
        else None
    )
    settlement.settled_at = datetime.now(UTC)


def _credit_completion(
    session: Session,
    *,
    settlement: CompletionSettlement,
    currency: WalletCurrency,
    amount: int,
    source_reference: str,
    policy_version: str = POLICY_VERSION,
) -> None:
    if amount <= 0:
        return
    post_entry(
        session,
        account_id=settlement.account_id,
        currency=currency,
        operation_id=f"completion:{settlement.run_id}:{settlement.life_index}:{currency.value}",
        direction="credit",
        amount=amount,
        source_kind="verified_completion",
        source_reference=source_reference,
        policy_version=policy_version,
        correlation_reference=f"{settlement.run_id}:{settlement.life_index}",
    )


def _lock_run_cap(session: Session, run_id: UUID, account_id: UUID) -> RunRewardCap:
    session.execute(
        insert(RunRewardCap)
        .values(run_id=run_id, account_id=account_id, feathers_credited=0)
        .on_conflict_do_nothing(index_elements=[RunRewardCap.run_id])
    )
    cap = session.scalar(
        select(RunRewardCap)
        .where(RunRewardCap.run_id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if cap is None:
        raise RuntimeError("run cap row could not be created or loaded")
    return cap


def _lock_live_batch_resources(session: Session, rows: list[tuple[CompletionSettlement, CompletionEvidence]]) -> None:
    supported = [
        (settlement, evidence)
        for settlement, evidence in rows
        if _simulation_identity(evidence.payload) in SUPPORTED_SIMULATION_IDENTITIES
    ]
    run_accounts = {settlement.run_id: settlement.account_id for settlement, _evidence in supported}
    caps = {
        run_id: _lock_run_cap(session, run_id, account_id)
        for run_id, account_id in sorted(run_accounts.items(), key=lambda item: item[0].int)
    }
    wallets: set[tuple[UUID, WalletCurrency]] = set()
    for settlement, evidence in supported:
        collections = evidence.payload["collections"]
        rewards = settlement_rewards(
            _simulation_identity(evidence.payload),
            feathers=int(collections[WalletCurrency.FEATHER.value]),
            game_stars=int(collections[WalletCurrency.GAME_STAR.value]),
            feathers_remaining=COIN_RUN_CAP - caps[settlement.run_id].feathers_credited,
        )
        if rewards is None:
            continue
        for currency, amount in zip(WalletCurrency, rewards, strict=True):
            if amount > 0:
                wallets.add((settlement.account_id, currency))
    for account_id, currency in sorted(wallets, key=lambda item: (item[0].int, item[1].value)):
        _lock_wallet_row(session, account_id, currency)


def _lock_wallet_row(session: Session, account_id: UUID, currency: WalletCurrency) -> None:
    statement = (
        select(Wallet)
        .where(Wallet.account_id == account_id, Wallet.currency == currency.value)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if session.scalar(statement) is not None:
        return
    session.execute(
        insert(Wallet)
        .values(account_id=account_id, currency=currency.value, balance=0)
        .on_conflict_do_nothing(index_elements=[Wallet.account_id, Wallet.currency])
    )
    if session.scalar(statement) is None:
        raise RuntimeError("wallet row could not be created or locked")


def _prior_lives_are_settled(session: Session, settlement: CompletionSettlement) -> bool:
    if settlement.life_index == 0:
        return True
    terminal_count = session.scalar(
        select(func.count())
        .select_from(CompletionSettlement)
        .where(
            CompletionSettlement.run_id == settlement.run_id,
            CompletionSettlement.life_index < settlement.life_index,
            CompletionSettlement.status.in_(TERMINAL_STATUSES),
        )
    )
    return terminal_count == settlement.life_index


def plan_historical_backfill(
    session: Session,
    *,
    activated_at: datetime,
    limit: int = 500,
    after: tuple[UUID, int] | None = None,
) -> BackfillPlan:
    """Plan one bounded page of pre-activation coin-only backfill without writes."""
    _validate_cutoff(activated_at)
    if type(limit) is not int or not 1 <= limit <= 5000:
        raise ValueError("limit must be an integer from 1 to 5000")
    _validate_backfill_cursor(after)
    rows = _backfill_rows(session, activated_at=activated_at, limit=limit + 1, after=after)
    has_more = len(rows) > limit
    visible = rows[:limit]
    run_ids = {evidence.run_id for evidence, _status in visible}
    caps = (
        {
            row.run_id: row.feathers_credited
            for row in session.scalars(select(RunRewardCap).where(RunRewardCap.run_id.in_(run_ids))).all()
        }
        if run_ids
        else {}
    )
    done = _terminal_lives(session, run_ids)
    planned: dict[UUID, int] = {}
    supported = 0
    unsupported = 0
    waiting = 0
    for evidence, status in visible:
        if status in TERMINAL_STATUSES:
            continue
        if not _prior_indexes_done(evidence.run_id, evidence.life_index, done):
            waiting += 1
            continue
        if _simulation_identity(evidence.payload) not in HISTORICAL_SIMULATION_IDENTITIES:
            unsupported += 1
            continue
        supported += 1
        cap_used = caps.get(evidence.run_id, 0) + planned.get(evidence.run_id, 0)
        requested = int(evidence.payload["collections"][WalletCurrency.FEATHER.value])
        reward = historical_coin_reward(_simulation_identity(evidence.payload), requested, COIN_RUN_CAP - cap_used)
        if reward is None:
            unsupported += 1
            continue
        planned[evidence.run_id] = planned.get(evidence.run_id, 0) + reward[0]
        done.setdefault(evidence.run_id, set()).add(evidence.life_index)
    return BackfillPlan(
        completion_count=supported,
        run_count=len({evidence.run_id for evidence, status in visible if status not in TERMINAL_STATUSES}),
        feathers_to_credit=sum(planned.values()),
        game_stars_to_credit=0,
        unsupported_count=unsupported,
        waiting_count=waiting,
        has_more=has_more,
        next_cursor=(visible[-1][0].run_id, visible[-1][0].life_index) if has_more and visible else None,
    )


def execute_historical_backfill(
    session: Session,
    *,
    settings: Settings,
    limit: int = 500,
    execute: bool = False,
    after: tuple[UUID, int] | None = None,
) -> BackfillResult:
    settings.validate_settlement_config()
    if not execute:
        raise ValueError("historical backfill requires the explicit execute flag")
    if settings.environment == "production":
        raise ValueError("historical backfill execution is disabled in production")
    cutoff = settings.economy_settlement_activated_at
    if not settings.economy_settlement_enabled or cutoff is None:
        raise ValueError("historical backfill requires enabled settlement and an activation timestamp")
    if type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError("limit must be an integer from 1 to 500")

    _validate_backfill_cursor(after)
    rows = _backfill_rows(session, activated_at=cutoff, limit=limit + 1, after=after)
    has_more = len(rows) > limit
    visible = rows[:limit]
    _lock_backfill_batch_resources(session, visible)
    run_ids = {evidence.run_id for evidence, _status in visible}
    done = _terminal_lives(session, run_ids)
    credits = 0
    unsupported = 0
    waiting = 0
    considered = 0
    for evidence, status in visible:
        if status in TERMINAL_STATUSES:
            continue
        considered += 1
        settlement = _lock_or_create_settlement(session, evidence)
        if settlement.status in TERMINAL_STATUSES:
            done.setdefault(evidence.run_id, set()).add(evidence.life_index)
            continue
        if not _prior_indexes_done(evidence.run_id, evidence.life_index, done):
            settlement.reason = "waiting_for_prior_life"
            waiting += 1
            continue
        identity = _simulation_identity(evidence.payload)
        if identity not in HISTORICAL_SIMULATION_IDENTITIES:
            settlement.status = "actionable_failure"
            settlement.reason = "unsupported_simulation_identity"
            settlement.settled_at = datetime.now(UTC)
            unsupported += 1
            continue
        cap = _lock_run_cap(session, evidence.run_id, settlement.account_id)
        requested = int(evidence.payload["collections"][WalletCurrency.FEATHER.value])
        historical_reward = historical_coin_reward(identity, requested, COIN_RUN_CAP - cap.feathers_credited)
        if historical_reward is None:
            raise RuntimeError("supported simulation identity lost its historical policy")
        amount, policy_version = historical_reward
        try:
            _credit_completion(
                session,
                settlement=settlement,
                currency=WalletCurrency.FEATHER,
                amount=amount,
                source_reference=str(evidence.event_id),
                policy_version=policy_version,
            )
        except WalletError:
            settlement.status = "actionable_failure"
            settlement.reason = "wallet_posting_failed"
            settlement.settled_at = datetime.now(UTC)
            unsupported += 1
            continue
        cap.feathers_credited += amount
        cap.updated_at = func.now()
        settlement.status = "committed"
        settlement.reason = (
            "historical_backfill_coins_only"
            if int(evidence.payload["collections"][WalletCurrency.GAME_STAR.value])
            else "historical_backfill"
        )
        settlement.policy_version = policy_version
        settlement.feathers_credited = amount
        settlement.stars_credited = 0
        settlement.settled_at = datetime.now(UTC)
        done.setdefault(evidence.run_id, set()).add(evidence.life_index)
        credits += amount
    return BackfillResult(
        considered,
        credits,
        0,
        unsupported,
        waiting,
        has_more,
        (visible[-1][0].run_id, visible[-1][0].life_index) if has_more and visible else None,
    )


def _lock_or_create_settlement(session: Session, evidence: CompletionEvidence) -> CompletionSettlement:
    session.execute(
        insert(CompletionSettlement)
        .values(
            id=uuid4(),
            event_id=evidence.event_id,
            run_id=evidence.run_id,
            life_index=evidence.life_index,
            account_id=UUID(str(evidence.payload["account_id"])),
            status="pending",
            reason="historical_backfill_required",
            completed_at=_payload_completed_at(evidence.payload),
        )
        .on_conflict_do_nothing(index_elements=[CompletionSettlement.run_id, CompletionSettlement.life_index])
    )
    settlement = session.scalar(
        select(CompletionSettlement)
        .where(CompletionSettlement.run_id == evidence.run_id, CompletionSettlement.life_index == evidence.life_index)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if settlement is None:
        raise RuntimeError("completion settlement could not be created or loaded")
    return settlement


def _backfill_rows(
    session: Session,
    *,
    activated_at: datetime,
    limit: int,
    after: tuple[UUID, int] | None = None,
) -> list[tuple[CompletionEvidence, str | None]]:
    completed_at = func.coalesce(
        CompletionSettlement.completed_at,
        cast(CompletionEvidence.payload["completed_at"].as_string(), DateTime(timezone=True)),
    )
    statement = (
        select(CompletionEvidence, CompletionSettlement.status)
        .outerjoin(CompletionSettlement, CompletionSettlement.event_id == CompletionEvidence.event_id)
        .where(
            completed_at < activated_at,
            (CompletionSettlement.id.is_(None)) | (CompletionSettlement.status == "pending"),
        )
        .order_by(CompletionEvidence.run_id, CompletionEvidence.life_index)
        .limit(limit)
    )
    if after is not None:
        statement = statement.where(
            tuple_(CompletionEvidence.run_id, CompletionEvidence.life_index)
            > tuple_(literal(after[0]), literal(after[1]))
        )
    return [(evidence, status) for evidence, status in session.execute(statement).all()]


def _lock_backfill_batch_resources(
    session: Session,
    rows: list[tuple[CompletionEvidence, str | None]],
) -> None:
    eligible = [
        evidence
        for evidence, status in rows
        if status not in TERMINAL_STATUSES
        and _simulation_identity(evidence.payload) in HISTORICAL_SIMULATION_IDENTITIES
    ]
    run_accounts = {evidence.run_id: UUID(str(evidence.payload["account_id"])) for evidence in eligible}
    caps = {
        run_id: _lock_run_cap(session, run_id, account_id)
        for run_id, account_id in sorted(run_accounts.items(), key=lambda item: item[0].int)
    }
    wallets: set[UUID] = set()
    for evidence in eligible:
        account_id = UUID(str(evidence.payload["account_id"]))
        requested = int(evidence.payload["collections"][WalletCurrency.FEATHER.value])
        if min(requested, COIN_RUN_CAP - caps[evidence.run_id].feathers_credited) > 0:
            wallets.add(account_id)
    for account_id in sorted(wallets, key=lambda value: value.int):
        _lock_wallet_row(session, account_id, WalletCurrency.FEATHER)


def _validate_backfill_cursor(after: tuple[UUID, int] | None) -> None:
    if after is None:
        return
    if (
        not isinstance(after, tuple)
        or len(after) != 2
        or not isinstance(after[0], UUID)
        or type(after[1]) is not int
        or after[1] < 0
    ):
        raise ValueError("backfill cursor must be a (run_id, nonnegative life_index) tuple")


def _terminal_lives(session: Session, run_ids: set[UUID]) -> dict[UUID, set[int]]:
    if not run_ids:
        return {}
    rows = session.execute(
        select(CompletionSettlement.run_id, CompletionSettlement.life_index).where(
            CompletionSettlement.run_id.in_(run_ids), CompletionSettlement.status.in_(TERMINAL_STATUSES)
        )
    ).all()
    done: dict[UUID, set[int]] = {}
    for run_id, life_index in rows:
        done.setdefault(run_id, set()).add(life_index)
    return done


def _prior_indexes_done(run_id: UUID, life_index: int, done: dict[UUID, set[int]]) -> bool:
    return len({index for index in done.get(run_id, set()) if index < life_index}) == life_index


def _simulation_identity(payload: dict[str, Any]) -> tuple[str, str, str]:
    return payload["simulation_version"], payload["generator_version"], payload["config_id"]


def settlement_batch_progress(statuses: Iterable[str]) -> int:
    """Count settlements advanced out of pending; deferred lives are not progress."""
    return sum(status != "pending" for status in statuses)


def settlement_rewards(
    identity: tuple[str, str, str], *, feathers: int, game_stars: int, feathers_remaining: int
) -> tuple[int, int] | None:
    """Return approved live rewards for a simulation identity, or None if unsupported."""
    if identity == SUPPORTED_SIMULATION_IDENTITY:
        return min(feathers, max(feathers_remaining, 0)), 0
    if identity in (
        STAR_SIMULATION_IDENTITY,
        WETLAND_SIMULATION_IDENTITY,
        VARIED_OBSTACLE_SIMULATION_IDENTITY,
        PAIRED_ROUTES_SIMULATION_IDENTITY,
        CURRENCY_FORMATIONS_SIMULATION_IDENTITY,
        COIN_COURSE_SIMULATION_IDENTITY,
        BONUS_SEGMENTS_SIMULATION_IDENTITY,
        BONUS_SEGMENTS_V2_SIMULATION_IDENTITY,
        CURVED_PIPES_SIMULATION_IDENTITY,
        VARIED_BASE_SIMULATION_IDENTITY,
        BASE_BONUS_SIMULATION_IDENTITY,
        DENSE_PIPES_SIMULATION_IDENTITY,
        PRESSURE_PIPES_SIMULATION_IDENTITY,
        VARIED_PIPES_SIMULATION_IDENTITY,
    ):
        return min(feathers, max(feathers_remaining, 0)), game_stars
    return None


def historical_coin_reward(
    identity: tuple[str, str, str], feathers: int, feathers_remaining: int
) -> tuple[int, str] | None:
    """Return the approved coin-only historical reward for a known profile."""
    if identity == SUPPORTED_SIMULATION_IDENTITY:
        policy_version = POLICY_VERSION
    elif identity == STAR_SIMULATION_IDENTITY:
        policy_version = HISTORICAL_STAR_POLICY_VERSION
    else:
        return None
    return min(feathers, max(feathers_remaining, 0)), policy_version


def _initial_reason(evidence: CompletionEvidence, settings: Settings) -> str:
    if not settings.economy_settlement_enabled:
        return "settlement_disabled"
    cutoff = settings.economy_settlement_activated_at
    if cutoff is None or _payload_completed_at(evidence.payload) < cutoff:
        return "historical_backfill_required"
    return "awaiting_settlement"


def _validate_cutoff(activated_at: datetime) -> None:
    if activated_at.tzinfo is None or activated_at.utcoffset() is None:
        raise ValueError("activation timestamp must include a timezone")


def _payload_completed_at(payload: dict[str, Any]) -> datetime:
    value = payload["completed_at"]
    if isinstance(value, datetime):
        completed_at = value
    else:
        completed_at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if completed_at.tzinfo is None or completed_at.utcoffset() is None:
        raise ValueError("completion timestamp must include a timezone")
    return completed_at.astimezone(UTC)

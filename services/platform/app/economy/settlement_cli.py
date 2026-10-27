from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import signal
import sys
from collections.abc import Callable
from threading import Event
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.database import create_bounded_engine
from app.economy.models import CompletionSettlement
from app.economy.settlement import (
    execute_historical_backfill,
    plan_historical_backfill,
    process_settlement_batch,
    retry_supported_failures,
)
from app.economy.wallet.ledger import reconcile_wallets
from app.settings import Settings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process or inspect Economy completion settlements.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    worker = subparsers.add_parser("settle", help="process one bounded batch of eligible completions")
    worker.add_argument("--limit", type=int, default=100)
    background_worker = subparsers.add_parser("worker", help="continuously settle bounded batches")
    background_worker.add_argument("--limit", type=int, default=100)
    background_worker.add_argument("--idle-seconds", type=float, default=2.0)
    background_worker.add_argument("--max-backoff-seconds", type=float, default=30.0)

    backfill = subparsers.add_parser("backfill", help="inspect or explicitly apply historical coin backfill")
    backfill.add_argument("--limit", type=int, default=500)
    backfill.add_argument("--after", help="continue after an encoded run/life cursor")
    backfill.add_argument(
        "--execute",
        action="store_true",
        help="apply this bounded page; without this flag the command only reports a dry-run plan",
    )
    retry = subparsers.add_parser("retry-failures", help="requeue a bounded page of newly supported failures")
    retry.add_argument("--limit", type=int, default=100)
    retry.add_argument("--after", help="continue after an encoded run/life cursor")
    audit = subparsers.add_parser("wallet-audit", help="read-only wallet ledger reconciliation")
    audit.add_argument("--limit", type=int, default=100)
    audit.add_argument("--after", help="continue after a wallet UUID cursor")
    return parser


def run_worker_loop(
    process_batch: Callable[[], int],
    *,
    stop_event: Event,
    idle_seconds: float,
    max_backoff_seconds: float,
    wait: Callable[[float], bool] | None = None,
    report_error: Callable[[], None] | None = None,
) -> None:
    """Run bounded settlement transactions until cancellation, idling or backing off between batches."""
    if not math.isfinite(idle_seconds) or idle_seconds <= 0:
        raise ValueError("idle_seconds must be a positive finite number")
    if not math.isfinite(max_backoff_seconds) or max_backoff_seconds < idle_seconds:
        raise ValueError("max_backoff_seconds must be finite and at least idle_seconds")
    wait_for_stop = wait or stop_event.wait
    backoff = idle_seconds
    while not stop_event.is_set():
        try:
            processed = process_batch()
        except SQLAlchemyError:
            if report_error is not None:
                report_error()
            if wait_for_stop(backoff):
                break
            backoff = min(backoff * 2, max_backoff_seconds)
            continue
        backoff = idle_seconds
        if processed <= 0 and wait_for_stop(idle_seconds):
            break


def _decode_cursor(value: str | None) -> tuple[UUID, int] | None:
    if value is None:
        return None
    if not value or len(value) > 128:
        raise ValueError("cursor is invalid")
    try:
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if not isinstance(payload, dict) or set(payload) != {"run_id", "life_index"}:
            raise ValueError("cursor is invalid")
        if (
            not isinstance(payload["run_id"], str)
            or type(payload["life_index"]) is not int
            or payload["life_index"] < 0
        ):
            raise ValueError("cursor is invalid")
        return UUID(payload["run_id"]), payload["life_index"]
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
        raise ValueError("cursor is invalid") from error


def _encode_cursor(value: tuple[UUID, int] | None) -> str | None:
    if value is None:
        return None
    raw = json.dumps({"run_id": str(value[0]), "life_index": value[1]}, sort_keys=True, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode("ascii")


def main() -> int:
    args = _parser().parse_args()
    settings = Settings.from_env()
    try:
        settings.validate_settlement_config()
        engine = create_bounded_engine(
            settings.economy_database_url,
            pool_size=settings.economy_pool_size,
            max_overflow=settings.economy_pool_max_overflow,
            pool_timeout=settings.economy_pool_timeout,
        )
        sessions = sessionmaker(engine, expire_on_commit=False)
        try:
            if args.command == "settle":
                with sessions.begin() as session:
                    processed = process_settlement_batch(session, settings=settings, limit=args.limit)
                with sessions() as session:
                    failures = session.scalar(
                        select(func.count())
                        .select_from(CompletionSettlement)
                        .where(CompletionSettlement.status == "actionable_failure")
                    )
                print(
                    json.dumps(
                        {
                            "command": "settle",
                            "enabled": settings.economy_settlement_enabled,
                            "processed": processed,
                            "actionable_failures": failures,
                        },
                        sort_keys=True,
                    )
                )
                return 1 if failures else 0

            if args.command == "worker":
                if not settings.economy_settlement_enabled or settings.economy_settlement_activated_at is None:
                    raise ValueError("worker requires enabled settlement and an activation timestamp")
                stop_event = Event()
                previous_sigint = signal.signal(signal.SIGINT, lambda _signum, _frame: stop_event.set())
                previous_sigterm = signal.signal(signal.SIGTERM, lambda _signum, _frame: stop_event.set())

                def process_batch() -> int:
                    with sessions.begin() as session:
                        return process_settlement_batch(session, settings=settings, limit=args.limit)

                def report_database_error() -> None:
                    print(json.dumps({"error": "settlement_worker_database_error"}), file=sys.stderr, flush=True)

                try:
                    run_worker_loop(
                        process_batch,
                        stop_event=stop_event,
                        idle_seconds=args.idle_seconds,
                        max_backoff_seconds=args.max_backoff_seconds,
                        report_error=report_database_error,
                    )
                finally:
                    signal.signal(signal.SIGINT, previous_sigint)
                    signal.signal(signal.SIGTERM, previous_sigterm)
                print(json.dumps({"command": "worker", "status": "stopped"}, sort_keys=True))
                return 0

            if args.command == "retry-failures":
                after = _decode_cursor(args.after)
                with sessions.begin() as session:
                    retry_result = retry_supported_failures(
                        session,
                        settings=settings,
                        limit=args.limit,
                        after=after,
                    )
                print(
                    json.dumps(
                        {
                            "command": "retry-failures",
                            "requeued": retry_result.requeued,
                            "has_more": retry_result.has_more,
                            "next_cursor": _encode_cursor(retry_result.next_cursor),
                        },
                        sort_keys=True,
                    )
                )
                return 0

            if args.command == "wallet-audit":
                after_wallet_id = UUID(args.after) if args.after is not None else None
                with sessions() as session:
                    page = reconcile_wallets(session, limit=args.limit, after_wallet_id=after_wallet_id)
                discrepancies = [item for item in page.items if item.discrepancy != 0]
                print(
                    json.dumps(
                        {
                            "command": "wallet-audit",
                            "wallets_checked": len(page.items),
                            "discrepancy_count": len(discrepancies),
                            "items": [
                                {
                                    "wallet_id": str(item.wallet_id),
                                    "account_id": str(item.account_id),
                                    "currency": item.currency.value,
                                    "balance": str(item.balance),
                                    "ledger_total": str(item.ledger_total),
                                    "discrepancy": str(item.discrepancy),
                                }
                                for item in page.items
                            ],
                            "next_cursor": str(page.next_wallet_id) if page.next_wallet_id else None,
                        },
                        sort_keys=True,
                    )
                )
                return 1 if discrepancies else 0

            cutoff = settings.economy_settlement_activated_at
            if cutoff is None:
                raise ValueError("ECONOMY_SETTLEMENT_ACTIVATED_AT is required for historical backfill")
            after = _decode_cursor(args.after)
            if args.execute:
                with sessions.begin() as session:
                    result = execute_historical_backfill(
                        session, settings=settings, limit=args.limit, execute=True, after=after
                    )
                print(
                    json.dumps(
                        {
                            "command": "backfill",
                            "mode": "execute",
                            "completions_considered": result.completions_considered,
                            "feathers_credited": result.feathers_credited,
                            "game_stars_credited": result.game_stars_credited,
                            "unsupported_count": result.unsupported_count,
                            "waiting_count": result.waiting_count,
                            "has_more": result.has_more,
                            "next_cursor": _encode_cursor(result.next_cursor),
                        },
                        sort_keys=True,
                    )
                )
                return 1 if result.unsupported_count or result.waiting_count else 0
            with sessions() as session:
                plan = plan_historical_backfill(session, activated_at=cutoff, limit=args.limit, after=after)
            print(
                json.dumps(
                    {
                        "command": "backfill",
                        "mode": "dry_run",
                        "completion_count": plan.completion_count,
                        "run_count": plan.run_count,
                        "feathers_to_credit": plan.feathers_to_credit,
                        "game_stars_to_credit": plan.game_stars_to_credit,
                        "unsupported_count": plan.unsupported_count,
                        "waiting_count": plan.waiting_count,
                        "has_more": plan.has_more,
                        "next_cursor": _encode_cursor(plan.next_cursor),
                    },
                    sort_keys=True,
                )
            )
            return 0
        finally:
            engine.dispose()
    except (SQLAlchemyError, OSError):
        print(json.dumps({"error": "economy_operation_failed"}), file=sys.stderr)
        return 1
    except ValueError as error:
        print(json.dumps({"error": "invalid_settlement_command", "reason": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

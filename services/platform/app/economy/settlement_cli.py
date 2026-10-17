from __future__ import annotations

import argparse
import base64
import binascii
import json
import sys
from uuid import UUID

from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.economy.models import CompletionSettlement
from app.economy.settlement import (
    execute_historical_backfill,
    plan_historical_backfill,
    process_settlement_batch,
    retry_supported_failures,
)
from app.settings import Settings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process or inspect Economy completion settlements.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    worker = subparsers.add_parser("settle", help="process one bounded batch of eligible completions")
    worker.add_argument("--limit", type=int, default=100)

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
    return parser


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
        engine = create_engine(settings.economy_database_url, pool_pre_ping=True)
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

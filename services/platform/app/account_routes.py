from __future__ import annotations

import base64
import binascii
import json
import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import literal, select, tuple_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dependencies import current_claims, get_economy_db, get_platform_db
from app.economy.models import CompletionEvidence, CompletionSettlement
from app.economy.wallet.models import Wallet, WalletCurrency, WalletLedgerEntry
from app.platform.models import Account
from app.schemas import (
    AccountResponse,
    CompletionSettlementResponse,
    WalletBalanceItem,
    WalletBalancesResponse,
    WalletEntryResponse,
    WalletHistoryResponse,
)
from app.settings import Settings
from app.tokens import TokenClaims

logger = logging.getLogger("doofy.platform")


def _encode_wallet_cursor(created_at: datetime, entry_id: uuid.UUID) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "entry_id": str(entry_id)}, sort_keys=True, separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_wallet_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    if not value or len(value) > 512:
        raise ValueError("invalid cursor")
    try:
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(payload, dict):
            raise ValueError("invalid cursor")
        if not isinstance(payload.get("created_at"), str) or not isinstance(payload.get("entry_id"), str):
            raise ValueError("invalid cursor")
        created_at = datetime.fromisoformat(payload["created_at"])
        entry_id = uuid.UUID(payload["entry_id"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ValueError("invalid cursor") from error
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("invalid cursor")
    return created_at, entry_id


def create_router(config: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/api/v1/account", response_model=AccountResponse)
    def own_account(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_platform_db)
    ) -> AccountResponse:
        account = db.get(Account, uuid.UUID(claims.subject))
        if account is None:
            raise HTTPException(status_code=404, detail="account not found")
        return AccountResponse(
            account_id=account.id, telegram_user_id=account.telegram_user_id, created_at=account.created_at
        )

    @router.get("/api/v1/wallets", response_model=WalletBalancesResponse)
    def own_wallets(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_economy_db)
    ) -> WalletBalancesResponse:
        account_id = uuid.UUID(claims.subject)
        try:
            wallets = db.scalars(select(Wallet).where(Wallet.account_id == account_id)).all()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("wallet_read_failed endpoint=balances")
            raise HTTPException(
                status_code=503, detail={"code": "wallet_unavailable", "message": "wallet is unavailable"}
            ) from None
        balances = {wallet.currency: wallet.balance for wallet in wallets}
        return WalletBalancesResponse(
            balances=[
                WalletBalanceItem(currency=currency.value, balance=str(balances.get(currency.value, 0)))
                for currency in WalletCurrency
            ]
        )

    @router.get("/api/v1/wallets/{currency}/entries", response_model=WalletHistoryResponse)
    def own_wallet_history(
        currency: WalletCurrency,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> WalletHistoryResponse:
        account_id = uuid.UUID(claims.subject)
        statement = select(WalletLedgerEntry).where(
            WalletLedgerEntry.account_id == account_id,
            WalletLedgerEntry.currency == currency.value,
        )
        if cursor is not None:
            try:
                created_at, entry_id = _decode_wallet_cursor(cursor)
            except ValueError:
                raise HTTPException(
                    status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
                ) from None
            statement = statement.where(
                tuple_(WalletLedgerEntry.created_at, WalletLedgerEntry.id)
                < tuple_(literal(created_at), literal(entry_id))
            )
        statement = statement.order_by(WalletLedgerEntry.created_at.desc(), WalletLedgerEntry.id.desc()).limit(
            limit + 1
        )
        try:
            rows = db.scalars(statement).all()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("wallet_read_failed endpoint=history")
            raise HTTPException(
                status_code=503, detail={"code": "wallet_unavailable", "message": "wallet is unavailable"}
            ) from None
        has_more = len(rows) > limit
        visible = rows[:limit]
        entries = [
            WalletEntryResponse(
                entry_id=row.id,
                currency=currency.value,
                operation_id=row.operation_id,
                delta=str(row.delta),
                source_kind=row.source_kind,
                source_reference=row.source_reference,
                policy_version=row.policy_version,
                correlation_reference=row.correlation_reference,
                created_at=row.created_at,
            )
            for row in visible
        ]
        next_cursor = _encode_wallet_cursor(visible[-1].created_at, visible[-1].id) if has_more and visible else None
        return WalletHistoryResponse(entries=entries, next_cursor=next_cursor)

    @router.get(
        "/api/v1/completions/{run_id}/{life_index}",
        response_model=CompletionSettlementResponse,
    )
    def own_completion_settlement(
        run_id: uuid.UUID,
        life_index: int,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> CompletionSettlementResponse:
        if life_index < 0:
            raise HTTPException(status_code=422, detail="invalid life index")
        account_id = uuid.UUID(claims.subject)
        try:
            result = db.execute(
                select(CompletionEvidence, CompletionSettlement)
                .outerjoin(CompletionSettlement, CompletionSettlement.event_id == CompletionEvidence.event_id)
                .where(
                    CompletionEvidence.run_id == run_id,
                    CompletionEvidence.life_index == life_index,
                    CompletionEvidence.payload["account_id"].as_string() == str(account_id),
                )
            ).one_or_none()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("completion_status_read_failed")
            raise HTTPException(
                status_code=503,
                detail={"code": "settlement_unavailable", "message": "completion status is unavailable"},
            ) from None
        if result is None:
            raise HTTPException(status_code=404, detail="completion not found")
        evidence, settlement = result
        if settlement is None:
            completed_at = datetime.fromisoformat(str(evidence.payload["completed_at"]).replace("Z", "+00:00"))
            reason = "settlement_not_queued"
            cutoff = config.economy_settlement_activated_at
            if not config.economy_settlement_enabled:
                reason = "settlement_disabled"
            elif cutoff is not None and completed_at < cutoff:
                reason = "historical_backfill_required"
            return CompletionSettlementResponse(
                event_id=evidence.event_id,
                run_id=evidence.run_id,
                life_index=evidence.life_index,
                status="pending",
                reason=reason,
                policy_version=None,
                credited={"FEATHER": "0", "GAME_STAR": "0"},
                completed_at=completed_at,
            )
        effective_reason = settlement.reason
        if settlement.status == "pending":
            cutoff = config.economy_settlement_activated_at
            if not config.economy_settlement_enabled:
                effective_reason = "settlement_disabled"
            elif cutoff is not None and settlement.completed_at < cutoff:
                effective_reason = "historical_backfill_required"
        return CompletionSettlementResponse(
            event_id=evidence.event_id,
            run_id=evidence.run_id,
            life_index=evidence.life_index,
            status=settlement.status,
            reason=effective_reason,
            policy_version=settlement.policy_version,
            credited={
                "FEATHER": str(settlement.feathers_credited),
                "GAME_STAR": str(settlement.stars_credited),
            },
            completed_at=settlement.completed_at,
        )

    return router

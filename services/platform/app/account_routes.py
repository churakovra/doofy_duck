from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import literal, select, tuple_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.cursors import decode_timestamp_cursor, encode_cursor
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


def create_router(config: Settings) -> APIRouter:
    router = APIRouter()

    def pending_reason(completed_at: datetime, default: str) -> str:
        if not config.economy_settlement_enabled:
            return "settlement_disabled"
        cutoff = config.economy_settlement_activated_at
        if cutoff is not None and completed_at < cutoff:
            return "historical_backfill_required"
        return default

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
                created_at, entry_id = decode_timestamp_cursor(cursor, "entry_id", strict_fields=False)
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
        next_cursor = (
            encode_cursor(created_at=visible[-1].created_at.isoformat(), entry_id=str(visible[-1].id))
            if len(rows) > limit
            else None
        )
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
            return CompletionSettlementResponse(
                event_id=evidence.event_id,
                run_id=evidence.run_id,
                life_index=evidence.life_index,
                status="pending",
                reason=pending_reason(completed_at, "settlement_not_queued"),
                policy_version=None,
                credited={"FEATHER": "0", "GAME_STAR": "0"},
                completed_at=completed_at,
            )
        reason = settlement.reason
        if settlement.status == "pending":
            reason = pending_reason(settlement.completed_at, reason)
        return CompletionSettlementResponse(
            event_id=evidence.event_id,
            run_id=evidence.run_id,
            life_index=evidence.life_index,
            status=settlement.status,
            reason=reason,
            policy_version=settlement.policy_version,
            credited={
                "FEATHER": str(settlement.feathers_credited),
                "GAME_STAR": str(settlement.stars_credited),
            },
            completed_at=settlement.completed_at,
        )

    return router

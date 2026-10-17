from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    DDL,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import EconomyBase


class WalletCurrency(StrEnum):
    FEATHER = "FEATHER"
    GAME_STAR = "GAME_STAR"


class Wallet(EconomyBase):
    __tablename__ = "wallets"
    __table_args__ = (
        UniqueConstraint("account_id", "currency", name="uq_wallet_account_currency"),
        CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_wallet_currency"),
        CheckConstraint("balance >= 0", name="ck_wallet_balance_nonnegative"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    currency: Mapped[str] = mapped_column(String(16), nullable=False)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WalletLedgerEntry(EconomyBase):
    __tablename__ = "wallet_ledger_entries"
    __table_args__ = (
        UniqueConstraint("account_id", "currency", "operation_id", name="uq_wallet_ledger_operation"),
        CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_wallet_ledger_currency"),
        CheckConstraint("delta <> 0", name="ck_wallet_ledger_delta_nonzero"),
        Index(
            "ix_wallet_ledger_account_currency_order",
            "account_id",
            "currency",
            "created_at",
            "id",
        ),
        Index("ix_wallet_ledger_wallet_id", "wallet_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    wallet_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wallets.id", ondelete="RESTRICT"), nullable=False)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    currency: Mapped[str] = mapped_column(String(16), nullable=False)
    operation_id: Mapped[str] = mapped_column(String(160), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    delta: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_kind: Mapped[str] = mapped_column(String(64), nullable=False)
    source_reference: Mapped[str] = mapped_column(String(200), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_reference: Mapped[str | None] = mapped_column(String(200))
    adjusts_entry_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("wallet_ledger_entries.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


_IMMUTABLE_LEDGER_FUNCTION = DDL(  # type: ignore[no-untyped-call]
    """
    CREATE OR REPLACE FUNCTION prevent_wallet_ledger_entry_mutation()
    RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION 'wallet ledger entries are immutable'
            USING ERRCODE = 'integrity_constraint_violation';
    END;
    $$ LANGUAGE plpgsql
    """
).execute_if(dialect="postgresql")
_IMMUTABLE_LEDGER_TRIGGER = DDL(  # type: ignore[no-untyped-call]
    """
    CREATE TRIGGER wallet_ledger_entries_immutable
    BEFORE UPDATE OR DELETE ON wallet_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_wallet_ledger_entry_mutation()
    """
).execute_if(dialect="postgresql")
event.listen(WalletLedgerEntry.__table__, "after_create", _IMMUTABLE_LEDGER_FUNCTION)
event.listen(WalletLedgerEntry.__table__, "after_create", _IMMUTABLE_LEDGER_TRIGGER)

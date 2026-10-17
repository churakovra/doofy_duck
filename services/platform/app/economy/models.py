from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import EconomyBase
from app.economy.shop.models import (  # noqa: F401
    CosmeticEntitlement,
    CosmeticEquipment,
    ShopPurchase,
    ShopPurchaseRequest,
    ShopQuote,
)
from app.economy.wallet.models import Wallet, WalletLedgerEntry  # noqa: F401


class CompletionEvidence(EconomyBase):
    __tablename__ = "completion_inbox"
    __table_args__ = (UniqueConstraint("run_id", "life_index", name="uq_completion_run_life"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(Uuid, unique=True, nullable=False)
    run_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    life_index: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CompletionSettlement(EconomyBase):
    __tablename__ = "completion_settlements"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_completion_settlements_event_id"),
        UniqueConstraint("run_id", "life_index", name="uq_completion_settlement_run_life"),
        CheckConstraint(
            "status IN ('pending', 'committed', 'ineligible', 'actionable_failure')",
            name="ck_completion_settlement_status",
        ),
        CheckConstraint("feathers_credited >= 0", name="ck_settlement_feathers_nonnegative"),
        CheckConstraint("stars_credited >= 0", name="ck_settlement_stars_nonnegative"),
        Index("ix_completion_settlements_status_run_life", "status", "run_id", "life_index"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("completion_inbox.event_id", ondelete="RESTRICT"), nullable=False
    )
    run_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    life_index: Mapped[int] = mapped_column(Integer, nullable=False)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    reason: Mapped[str | None] = mapped_column(String(64))
    policy_version: Mapped[str | None] = mapped_column(String(64))
    feathers_credited: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    stars_credited: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RunRewardCap(EconomyBase):
    __tablename__ = "run_reward_caps"
    __table_args__ = (CheckConstraint("feathers_credited BETWEEN 0 AND 30", name="ck_run_reward_cap_feathers"),)

    run_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    feathers_credited: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

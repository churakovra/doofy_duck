from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    DDL,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import EconomyBase


class CosmeticEntitlement(EconomyBase):
    __tablename__ = "cosmetic_entitlements"
    __table_args__ = (
        UniqueConstraint("account_id", "item_type", "item_id", name="uq_cosmetic_entitlement_equipment_fk"),
        CheckConstraint("item_type IN ('skin', 'background')", name="ck_cosmetic_entitlement_type"),
        Index("ix_cosmetic_entitlements_account_order", "account_id", "item_type", "item_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    item_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    grant_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    grant_reference: Mapped[str] = mapped_column(String(200), nullable=False)
    catalog_version: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CosmeticEquipment(EconomyBase):
    __tablename__ = "cosmetic_equipment"
    __table_args__ = (
        CheckConstraint("item_type IN ('skin', 'background')", name="ck_cosmetic_equipment_type"),
        CheckConstraint("revision >= 1", name="ck_cosmetic_equipment_revision"),
        ForeignKeyConstraint(
            ["account_id", "item_type", "item_id"],
            ["cosmetic_entitlements.account_id", "cosmetic_entitlements.item_type", "cosmetic_entitlements.item_id"],
            name="fk_cosmetic_equipment_owned_item",
            ondelete="RESTRICT",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    item_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ShopQuote(EconomyBase):
    __tablename__ = "shop_quotes"
    __table_args__ = (
        UniqueConstraint("account_id", "id", name="uq_shop_quote_account_id"),
        CheckConstraint("item_type IN ('skin', 'background')", name="ck_shop_quote_item_type"),
        CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_shop_quote_currency"),
        CheckConstraint("amount > 0", name="ck_shop_quote_amount_positive"),
        CheckConstraint("expires_at > created_at", name="ck_shop_quote_expiry"),
        Index("ix_shop_quotes_account_created", "account_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    item_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    catalog_version: Mapped[str] = mapped_column(String(32), nullable=False)
    eligibility_version: Mapped[str] = mapped_column(String(48), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ShopPurchase(EconomyBase):
    __tablename__ = "shop_purchases"
    __table_args__ = (
        UniqueConstraint("account_id", "id", name="uq_shop_purchase_account_id"),
        UniqueConstraint("account_id", "quote_id", name="uq_shop_purchase_quote"),
        CheckConstraint("item_type IN ('skin', 'background')", name="ck_shop_purchase_item_type"),
        CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_shop_purchase_currency"),
        CheckConstraint("amount > 0", name="ck_shop_purchase_amount_positive"),
        CheckConstraint("status = 'committed'", name="ck_shop_purchase_committed"),
        ForeignKeyConstraint(
            ["account_id", "quote_id"],
            ["shop_quotes.account_id", "shop_quotes.id"],
            name="fk_shop_purchase_account_quote",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["account_id", "item_type", "item_id"],
            ["cosmetic_entitlements.account_id", "cosmetic_entitlements.item_type", "cosmetic_entitlements.item_id"],
            name="fk_shop_purchase_entitlement",
            ondelete="RESTRICT",
        ),
        Index("ix_shop_purchases_account_created", "account_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    quote_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    item_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    catalog_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="committed")
    ledger_entry_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("wallet_ledger_entries.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ShopPurchaseRequest(EconomyBase):
    __tablename__ = "shop_purchase_requests"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "purchase_id"],
            ["shop_purchases.account_id", "shop_purchases.id"],
            name="fk_shop_request_purchase_result",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_shop_request_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_shop_request_fingerprint_length"),
    )

    account_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    purchase_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


_IMMUTABLE_SHOP_FUNCTION = DDL(  # type: ignore[no-untyped-call]
    """
    CREATE OR REPLACE FUNCTION prevent_shop_record_mutation()
    RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION 'shop records are immutable'
            USING ERRCODE = 'integrity_constraint_violation';
    END;
    $$ LANGUAGE plpgsql
    """
).execute_if(dialect="postgresql")

event.listen(CosmeticEntitlement.__table__, "after_create", _IMMUTABLE_SHOP_FUNCTION)
_IMMUTABLE_SHOP_TRIGGER = DDL(  # type: ignore[no-untyped-call]
    "CREATE TRIGGER %(table)s_immutable BEFORE UPDATE OR DELETE ON %(table)s "
    "FOR EACH ROW EXECUTE FUNCTION prevent_shop_record_mutation()"
).execute_if(dialect="postgresql")
for _immutable_table in (CosmeticEntitlement, ShopQuote, ShopPurchase, ShopPurchaseRequest):
    event.listen(_immutable_table.__table__, "after_create", _IMMUTABLE_SHOP_TRIGGER)

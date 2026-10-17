from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.economy.shop.catalog import CATALOG_VERSION, ELIGIBILITY_VERSION, OFFERS_BY_ID, OFFERS_BY_KEY, ItemType
from app.economy.shop.models import CosmeticEntitlement, ShopPurchase, ShopPurchaseRequest, ShopQuote
from app.economy.wallet.ledger import InsufficientFunds, post_entry
from app.economy.wallet.models import Wallet, WalletCurrency


class ShopError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 409, current: dict[str, object] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.current = current


@dataclass(frozen=True)
class PurchaseResult:
    purchase: ShopPurchase
    replayed: bool


def make_quote(
    session: Session, *, account_id: UUID, item_type: str, item_id: str, now: datetime | None = None
) -> ShopQuote:
    offer = OFFERS_BY_KEY.get((cast(ItemType, item_type), item_id))
    if offer is None:
        if item_id in OFFERS_BY_ID:
            raise ShopError("wrong_item_type", "item belongs to another category")
        raise ShopError("item_not_found", "item was not found", status_code=404)
    if offer.is_default or offer.price_currency is None or offer.price_amount is None:
        raise ShopError("item_not_for_sale", "default items do not have purchase quotes")
    if _owns(session, account_id=account_id, item_type=item_type, item_id=item_id):
        raise ShopError("already_owned", "item is already owned")
    current = now or datetime.now(UTC)
    quote = ShopQuote(
        id=uuid4(),
        account_id=account_id,
        item_type=item_type,
        item_id=item_id,
        currency=offer.price_currency,
        amount=offer.price_amount,
        catalog_version=CATALOG_VERSION,
        eligibility_version=ELIGIBILITY_VERSION,
        created_at=current,
        expires_at=current + timedelta(seconds=300),
    )
    session.add(quote)
    session.flush()
    return quote


def commit_purchase(
    session: Session,
    *,
    account_id: UUID,
    quote_id: UUID,
    idempotency_key: str,
    enabled: bool,
    now: datetime | None = None,
) -> PurchaseResult:
    if not idempotency_key or idempotency_key != idempotency_key.strip() or len(idempotency_key) > 128:
        raise ShopError(
            "invalid_idempotency_key", "Idempotency-Key must be trimmed text of at most 128 characters", status_code=422
        )

    fingerprint = _purchase_fingerprint(account_id, quote_id)
    reserved_id = uuid4()
    inserted = session.execute(
        insert(ShopPurchaseRequest)
        .values(
            account_id=account_id,
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
            purchase_id=reserved_id,
        )
        .on_conflict_do_nothing(index_elements=[ShopPurchaseRequest.account_id, ShopPurchaseRequest.idempotency_key])
        .returning(ShopPurchaseRequest.purchase_id)
    ).scalar_one_or_none()
    reservation = session.scalar(
        select(ShopPurchaseRequest)
        .where(
            ShopPurchaseRequest.account_id == account_id,
            ShopPurchaseRequest.idempotency_key == idempotency_key,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if reservation is None:
        raise RuntimeError("purchase request reservation was not created")
    if reservation.request_fingerprint != fingerprint:
        raise ShopError("idempotency_conflict", "idempotency key was used for a different quote")
    if inserted is None:
        purchase = session.scalar(
            select(ShopPurchase).where(
                ShopPurchase.account_id == account_id, ShopPurchase.id == reservation.purchase_id
            )
        )
        if purchase is None:
            raise RuntimeError("committed purchase request has no result")
        return PurchaseResult(purchase, True)
    if not enabled:
        raise ShopError("shop_disabled", "shop mutations are disabled", status_code=503)

    quote = session.scalar(
        select(ShopQuote)
        .where(ShopQuote.account_id == account_id, ShopQuote.id == quote_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if quote is None:
        raise ShopError("quote_not_found", "quote was not found", status_code=404)
    current = now or datetime.now(UTC)
    if quote.expires_at <= current:
        raise ShopError("expired_quote", "quote has expired")
    offer = OFFERS_BY_KEY.get((cast(ItemType, quote.item_type), quote.item_id))
    if (
        quote.catalog_version != CATALOG_VERSION
        or offer is None
        or offer.price_currency != quote.currency
        or offer.price_amount != quote.amount
    ):
        raise ShopError("stale_quote", "quote no longer matches the current offer")
    if quote.eligibility_version != ELIGIBILITY_VERSION:
        raise ShopError("ineligible", "quote eligibility is no longer supported")
    if quote.id != quote_id:
        raise ShopError("quote_not_found", "quote was not found", status_code=404)

    purchase_id = reservation.purchase_id
    # Serialize every purchase for an account/currency before checking ownership.
    # A second quote for an item bought moments ago must fail as already-owned,
    # without spending any of the remaining wallet balance.
    session.execute(
        insert(Wallet)
        .values(account_id=account_id, currency=quote.currency, balance=0)
        .on_conflict_do_nothing(index_elements=[Wallet.account_id, Wallet.currency])
    )
    wallet = session.scalar(
        select(Wallet)
        .where(Wallet.account_id == account_id, Wallet.currency == quote.currency)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if wallet is None:
        raise RuntimeError("wallet could not be created or locked")
    if quote.expires_at <= (now or datetime.now(UTC)):
        raise ShopError("expired_quote", "quote has expired")
    if _owns(session, account_id=account_id, item_type=quote.item_type, item_id=quote.item_id):
        raise ShopError("already_owned", "item is already owned")
    try:
        ledger_entry = post_entry(
            session,
            account_id=account_id,
            currency=WalletCurrency(quote.currency),
            operation_id=f"shop:{purchase_id}",
            direction="debit",
            amount=quote.amount,
            source_kind="cosmetic_purchase",
            source_reference=str(purchase_id),
            policy_version=quote.catalog_version,
            correlation_reference=str(quote.id),
        )
    except InsufficientFunds as error:
        raise ShopError("insufficient_funds", str(error)) from error

    entitlement = CosmeticEntitlement(
        account_id=account_id,
        item_type=quote.item_type,
        item_id=quote.item_id,
        grant_kind="purchase",
        grant_reference=str(purchase_id),
        catalog_version=quote.catalog_version,
    )
    session.add(entitlement)
    session.flush()
    purchase = ShopPurchase(
        id=purchase_id,
        account_id=account_id,
        quote_id=quote.id,
        item_type=quote.item_type,
        item_id=quote.item_id,
        currency=quote.currency,
        amount=quote.amount,
        catalog_version=quote.catalog_version,
        status="committed",
        ledger_entry_id=ledger_entry.id,
    )
    session.add(purchase)
    session.flush()
    return PurchaseResult(purchase, False)


def serialize_quote(quote: ShopQuote) -> dict[str, object]:
    return {
        "quote_id": str(quote.id),
        "catalog_version": quote.catalog_version,
        "eligibility_version": quote.eligibility_version,
        "item_type": quote.item_type,
        "item_id": quote.item_id,
        "currency": quote.currency,
        "amount": str(quote.amount),
        "created_at": quote.created_at,
        "expires_at": quote.expires_at,
    }


def serialize_purchase(purchase: ShopPurchase) -> dict[str, object]:
    return {
        "purchase_id": str(purchase.id),
        "quote_id": str(purchase.quote_id),
        "item_type": purchase.item_type,
        "item_id": purchase.item_id,
        "currency": purchase.currency,
        "amount": str(purchase.amount),
        "catalog_version": purchase.catalog_version,
        "status": purchase.status,
        "created_at": purchase.created_at,
    }


def _owns(session: Session, *, account_id: UUID, item_type: str, item_id: str) -> bool:
    return (
        session.scalar(
            select(CosmeticEntitlement.id).where(
                CosmeticEntitlement.account_id == account_id,
                CosmeticEntitlement.item_type == item_type,
                CosmeticEntitlement.item_id == item_id,
            )
        )
        is not None
    )


def _purchase_fingerprint(account_id: UUID, quote_id: UUID) -> str:
    canonical = json.dumps(
        {"account_id": str(account_id), "quote_id": str(quote_id)}, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()

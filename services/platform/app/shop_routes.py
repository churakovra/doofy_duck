from __future__ import annotations

import base64
import binascii
import json
import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import func, literal, select, tuple_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dependencies import current_claims, get_economy_db
from app.economy.inventory import decode_inventory_cursor, ensure_starter_state, list_inventory
from app.economy.shop.catalog import OFFERS_BY_ID, public_catalog
from app.economy.shop.models import CosmeticEntitlement, CosmeticEquipment, ShopPurchase, ShopPurchaseRequest
from app.economy.shop.service import ShopError, commit_purchase, make_quote, serialize_purchase, serialize_quote
from app.economy.wallet.models import Wallet
from app.schemas import (
    EquipmentUpdateRequest,
    ShopPurchaseRequestBody,
    ShopQuoteRequest,
)
from app.settings import Settings
from app.tokens import TokenClaims

logger = logging.getLogger("doofy.platform")


def _encode_shop_cursor(created_at: datetime, purchase_id: uuid.UUID) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "purchase_id": str(purchase_id)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_shop_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    if not value or len(value) > 512:
        raise ValueError("invalid cursor")
    try:
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(payload, dict) or set(payload) != {"created_at", "purchase_id"}:
            raise ValueError("invalid cursor")
        if not isinstance(payload["created_at"], str) or not isinstance(payload["purchase_id"], str):
            raise ValueError("invalid cursor")
        created_at = datetime.fromisoformat(payload["created_at"])
        purchase_id = uuid.UUID(payload["purchase_id"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ValueError("invalid cursor") from error
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("invalid cursor")
    return created_at, purchase_id


def _shop_error(error: ShopError) -> HTTPException:
    detail: dict[str, object] = {"code": error.code, "message": error.message}
    if error.current is not None:
        detail["current"] = error.current
    return HTTPException(status_code=error.status_code, detail=detail)


def create_router(config: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/api/v1/shop/catalog")
    def shop_catalog(claims: TokenClaims = Depends(current_claims)) -> dict[str, object]:
        del claims
        return public_catalog(enabled=config.economy_shop_enabled)

    @router.get("/api/v1/shop/inventory")
    def shop_inventory(
        limit: Annotated[int, Query(ge=1, le=100)] = 100,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            if cursor is not None:
                decode_inventory_cursor(cursor)
            with db.begin():
                ensure_starter_state(db, account_id)
                page = list_inventory(db, account_id=account_id, limit=limit, cursor=cursor)
            return {
                "items": [
                    {
                        "item_type": item.item_type,
                        "item_id": item.item_id,
                        "grant_kind": item.grant_kind,
                        "catalog_version": item.catalog_version,
                        "granted_at": item.granted_at,
                    }
                    for item in page.items
                ],
                "next_cursor": page.next_cursor,
            }
        except ValueError:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
            ) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=inventory")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.get("/api/v1/shop/equipment")
    def shop_equipment(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_economy_db)
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                rows = db.scalars(
                    select(CosmeticEquipment)
                    .where(CosmeticEquipment.account_id == account_id)
                    .order_by(CosmeticEquipment.item_type)
                ).all()
            return {
                "equipment": [
                    {"item_type": row.item_type, "item_id": row.item_id, "revision": row.revision} for row in rows
                ]
            }
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=equipment")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.put("/api/v1/shop/equipment/{item_type}")
    def update_shop_equipment(
        item_type: str,
        body: EquipmentUpdateRequest,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if not config.economy_shop_enabled:
            raise HTTPException(
                status_code=503, detail={"code": "shop_disabled", "message": "shop mutations are disabled"}
            )
        if item_type not in {"skin", "background"}:
            raise HTTPException(
                status_code=404, detail={"code": "item_type_not_found", "message": "item type not found"}
            )
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                offer = OFFERS_BY_ID.get(body.item_id)
                if offer is None:
                    raise ShopError("item_not_found", "item was not found", status_code=404)
                if offer.item_type != item_type:
                    raise ShopError("wrong_item_type", "item belongs to another category")
                owned = db.scalar(
                    select(CosmeticEntitlement.id).where(
                        CosmeticEntitlement.account_id == account_id,
                        CosmeticEntitlement.item_type == item_type,
                        CosmeticEntitlement.item_id == body.item_id,
                    )
                )
                if owned is None:
                    raise ShopError("item_not_owned", "item is not owned")
                current = db.scalar(
                    select(CosmeticEquipment)
                    .where(CosmeticEquipment.account_id == account_id, CosmeticEquipment.item_type == item_type)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if current is None:
                    raise RuntimeError("starter equipment row is missing")
                if body.expected_revision != current.revision:
                    raise ShopError(
                        "stale_equipment",
                        "equipment changed",
                        current={
                            "item_type": current.item_type,
                            "item_id": current.item_id,
                            "revision": current.revision,
                        },
                    )
                current.item_id = body.item_id
                current.revision += 1
                current.updated_at = func.now()
                db.flush()
                return {"item_type": current.item_type, "item_id": current.item_id, "revision": current.revision}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=equipment")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.post("/api/v1/shop/quotes", status_code=201)
    def create_shop_quote(
        body: ShopQuoteRequest,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if not config.economy_shop_enabled:
            raise HTTPException(
                status_code=503, detail={"code": "shop_disabled", "message": "shop mutations are disabled"}
            )
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                quote = make_quote(db, account_id=account_id, item_type=body.item_type, item_id=body.item_id)
            return serialize_quote(quote)
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=quote")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.post("/api/v1/shop/purchases")
    def create_shop_purchase(
        body: ShopPurchaseRequestBody,
        response: Response,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if idempotency_key is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key is required"},
            )
        try:
            with db.begin():
                result = commit_purchase(
                    db,
                    account_id=account_id,
                    quote_id=body.quote_id,
                    idempotency_key=idempotency_key,
                    enabled=config.economy_shop_enabled,
                )
            balance = db.scalar(
                select(Wallet.balance).where(
                    Wallet.account_id == account_id, Wallet.currency == result.purchase.currency
                )
            )
            response.status_code = 200 if result.replayed else 201
            return {"purchase": serialize_purchase(result.purchase), "current_balance": str(balance or 0)}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=purchase")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.get("/api/v1/shop/purchases/lookup")
    def lookup_shop_purchase(
        idempotency_key: Annotated[str, Query(alias="idempotency_key", min_length=1, max_length=128)],
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if idempotency_key != idempotency_key.strip():
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_idempotency_key", "message": "idempotency_key must be trimmed"},
            )
        try:
            row = db.execute(
                select(ShopPurchaseRequest, ShopPurchase)
                .join(
                    ShopPurchase,
                    (ShopPurchase.account_id == ShopPurchaseRequest.account_id)
                    & (ShopPurchase.id == ShopPurchaseRequest.purchase_id),
                )
                .where(
                    ShopPurchaseRequest.account_id == account_id,
                    ShopPurchaseRequest.idempotency_key == idempotency_key,
                )
            ).one_or_none()
            if row is None:
                raise ShopError("purchase_not_found", "purchase was not found", status_code=404)
            request, purchase = row
            balance = db.scalar(
                select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == purchase.currency)
            )
            return {
                "purchase": serialize_purchase(purchase),
                "idempotency_key": request.idempotency_key,
                "current_balance": str(balance or 0),
            }
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase_lookup")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.get("/api/v1/shop/purchases/{purchase_id}")
    def get_shop_purchase(
        purchase_id: uuid.UUID,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            purchase = db.scalar(
                select(ShopPurchase).where(ShopPurchase.id == purchase_id, ShopPurchase.account_id == account_id)
            )
            if purchase is None:
                raise ShopError("purchase_not_found", "purchase was not found", status_code=404)
            balance = db.scalar(
                select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == purchase.currency)
            )
            return {"purchase": serialize_purchase(purchase), "current_balance": str(balance or 0)}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @router.get("/api/v1/shop/purchases")
    def list_shop_purchases(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            after = _decode_shop_cursor(cursor) if cursor is not None else None
            statement = select(ShopPurchase).where(ShopPurchase.account_id == account_id)
            if after is not None:
                statement = statement.where(
                    tuple_(ShopPurchase.created_at, ShopPurchase.id) < tuple_(literal(after[0]), literal(after[1]))
                )
            rows = db.scalars(
                statement.order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc()).limit(limit + 1)
            ).all()
            visible = rows[:limit]
            balances = {
                currency: db.scalar(
                    select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == currency)
                )
                or 0
                for currency in {purchase.currency for purchase in visible}
            }
            next_cursor = (
                _encode_shop_cursor(visible[-1].created_at, visible[-1].id) if len(rows) > limit and visible else None
            )
            return {
                "purchases": [
                    {
                        "purchase": serialize_purchase(purchase),
                        "current_balance": str(balances[purchase.currency]),
                    }
                    for purchase in visible
                ],
                "next_cursor": next_cursor,
            }
        except ValueError:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
            ) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase_history")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    return router

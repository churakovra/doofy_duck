"""Account-owned cosmetic entitlement and equipment operations."""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.economy.shop.models import CosmeticEntitlement, CosmeticEquipment

DEFAULT_ITEMS = (("skin", "classic"), ("background", "meadow"))


@dataclass(frozen=True)
class InventoryPage:
    items: tuple[CosmeticEntitlement, ...]
    next_cursor: str | None


def ensure_starter_state(session: Session, account_id: UUID) -> None:
    """Idempotently grant the two free defaults and select them."""
    session.execute(
        insert(CosmeticEntitlement)
        .values(
            [
                {
                    "account_id": account_id,
                    "item_type": item_type,
                    "item_id": item_id,
                    "grant_kind": "default",
                    "grant_reference": "starter-cosmetics-v1",
                    "catalog_version": "cosmetics-v1",
                }
                for item_type, item_id in DEFAULT_ITEMS
            ]
        )
        .on_conflict_do_nothing(index_elements=["account_id", "item_type", "item_id"])
    )
    session.execute(
        insert(CosmeticEquipment)
        .values(
            [
                {"account_id": account_id, "item_type": item_type, "item_id": item_id, "revision": 1}
                for item_type, item_id in DEFAULT_ITEMS
            ]
        )
        .on_conflict_do_nothing(index_elements=["account_id", "item_type"])
    )


def list_inventory(session: Session, *, account_id: UUID, limit: int, cursor: str | None) -> InventoryPage:
    after = decode_inventory_cursor(cursor) if cursor is not None else None
    statement = select(CosmeticEntitlement).where(CosmeticEntitlement.account_id == account_id)
    if after is not None:
        statement = statement.where(tuple_(CosmeticEntitlement.item_type, CosmeticEntitlement.item_id) > after)
    rows = session.scalars(
        statement.order_by(CosmeticEntitlement.item_type, CosmeticEntitlement.item_id).limit(limit + 1)
    ).all()
    visible = rows[:limit]
    next_cursor = encode_inventory_cursor(visible[-1].item_type, visible[-1].item_id) if len(rows) > limit else None
    return InventoryPage(tuple(visible), next_cursor)


def decode_inventory_cursor(value: str) -> tuple[str, str]:
    if not value or len(value) > 256:
        raise ValueError("invalid cursor")
    try:
        payload: Any = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(payload, dict) or set(payload) != {"item_type", "item_id"}:
            raise ValueError("invalid cursor")
        item_type, item_id = payload["item_type"], payload["item_id"]
        if not isinstance(item_type, str) or not isinstance(item_id, str) or not (1 <= len(item_type) <= 16):
            raise ValueError("invalid cursor")
        if not 1 <= len(item_id) <= 64:
            raise ValueError("invalid cursor")
        return item_type, item_id
    except (TypeError, ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ValueError("invalid cursor") from error


def encode_inventory_cursor(item_type: str, item_id: str) -> str:
    payload = json.dumps({"item_type": item_type, "item_id": item_id}, sort_keys=True, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode("ascii")

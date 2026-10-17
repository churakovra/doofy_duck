from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

CATALOG_VERSION = "cosmetics-v1"
ELIGIBILITY_VERSION = "telegram-account-v1"
QUOTE_TTL_SECONDS = 300
ItemType = Literal["skin", "background"]


@dataclass(frozen=True)
class Offer:
    item_type: ItemType
    item_id: str
    name_en: str
    name_ru: str
    price_currency: str | None
    price_amount: int | None

    @property
    def is_default(self) -> bool:
        return self.price_amount is None

    def as_dict(self) -> dict[str, object]:
        return {
            "item_type": self.item_type,
            "item_id": self.item_id,
            "display_name": {"en": self.name_en, "ru": self.name_ru},
            "asset_id": self.item_id,
            "default": self.is_default,
            "available": True,
            "price": None
            if self.price_amount is None
            else {"currency": self.price_currency, "amount": str(self.price_amount)},
        }


OFFERS: tuple[Offer, ...] = (
    Offer("skin", "classic", "Classic", "Классика", None, None),
    Offer("skin", "mint", "Mint", "Мята", "FEATHER", 20),
    Offer("skin", "rose", "Rose", "Роза", "FEATHER", 200),
    Offer("skin", "celestial", "Celestial", "Небесный", "GAME_STAR", 100),
    Offer("skin", "royal", "Royal", "Королевский", "GAME_STAR", 200),
    Offer("background", "meadow", "Meadow", "Луг", None, None),
    Offer("background", "dusk", "Dusk", "Сумерки", "FEATHER", 20),
    Offer("background", "winter", "Winter", "Зима", "FEATHER", 200),
    Offer("background", "nebula", "Nebula", "Туманность", "GAME_STAR", 100),
    Offer("background", "aurora", "Aurora", "Аврора", "GAME_STAR", 200),
)
OFFERS_BY_KEY = {(offer.item_type, offer.item_id): offer for offer in OFFERS}
OFFERS_BY_ID = {offer.item_id: offer for offer in OFFERS}


def public_catalog(*, enabled: bool) -> dict[str, object]:
    return {
        "catalog_version": CATALOG_VERSION,
        "enabled": enabled,
        "items": [offer.as_dict() for offer in OFFERS],
    }

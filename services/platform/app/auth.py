from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl


@dataclass(frozen=True)
class TelegramIdentity:
    telegram_user_id: int
    first_name: str | None
    username: str | None
    auth_date: int


class TelegramInitDataError(ValueError):
    pass


def verify_telegram_init_data(
    init_data: str,
    bot_token: str,
    *,
    now: datetime | None = None,
    max_age: timedelta = timedelta(minutes=10),
) -> TelegramIdentity:
    if not bot_token or not init_data or len(init_data) > 16_384:
        raise TelegramInitDataError("invalid initialization data")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        if len(dict(pairs)) != len(pairs):
            raise TelegramInitDataError("duplicate initialization field")
        fields = dict(pairs)
        supplied_hash = fields.pop("hash")
        auth_date = int(fields["auth_date"])
        user = json.loads(fields["user"])
        user_id = int(user["id"])
        if user_id <= 0:
            raise TelegramInitDataError("invalid Telegram user")
    except TelegramInitDataError:
        raise
    except (ValueError, KeyError, TypeError, OverflowError, json.JSONDecodeError) as exc:
        raise TelegramInitDataError("invalid initialization data") from exc

    try:
        data_check = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
        secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        expected_hash = hmac.new(secret, data_check.encode("utf-8"), hashlib.sha256).hexdigest()
        valid_signature = hmac.compare_digest(supplied_hash, expected_hash)
    except (UnicodeEncodeError, TypeError):
        raise TelegramInitDataError("invalid initialization data") from None
    if not valid_signature:
        raise TelegramInitDataError("invalid initialization signature")
    current = int((now or datetime.now(UTC)).timestamp())
    if auth_date > current + 30 or current - auth_date > int(max_age.total_seconds()):
        raise TelegramInitDataError("initialization data is stale")
    return TelegramIdentity(user_id, user.get("first_name"), user.get("username"), auth_date)

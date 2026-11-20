"""Wire encoding for opaque keyset pagination cursors."""

from __future__ import annotations

import base64
import json
from datetime import datetime
from uuid import UUID


def encode_cursor(**fields: str) -> str:
    payload = json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def decode_cursor(value: str, *, max_length: int) -> dict[str, object]:
    if not value or len(value) > max_length:
        raise ValueError("invalid cursor")
    try:
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
    except ValueError as error:
        raise ValueError("invalid cursor") from error
    if not isinstance(payload, dict):
        raise ValueError("invalid cursor")
    return payload


def decode_timestamp_cursor(value: str, id_field: str, *, strict_fields: bool = True) -> tuple[datetime, UUID]:
    payload = decode_cursor(value, max_length=512)
    if strict_fields and set(payload) != {"created_at", id_field}:
        raise ValueError("invalid cursor")
    timestamp, identifier = payload.get("created_at"), payload.get(id_field)
    if not isinstance(timestamp, str) or not isinstance(identifier, str):
        raise ValueError("invalid cursor")
    created_at = datetime.fromisoformat(timestamp)
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("invalid cursor")
    return created_at, UUID(identifier)

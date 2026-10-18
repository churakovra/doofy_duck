#!/usr/bin/env python3
"""Add missing local-only economy defaults without changing existing settings."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


def ensure_dev_env(path: Path, now: Callable[[], datetime] | None = None) -> None:
    """Append local economy defaults that are absent from an existing env file."""
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    present = {
        line.split("=", 1)[0].removeprefix("export ").strip()
        for line in existing.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    additions: list[str] = []
    if "ECONOMY_SETTLEMENT_ENABLED" not in present:
        additions.append("ECONOMY_SETTLEMENT_ENABLED='true'")
    if "ECONOMY_SHOP_ENABLED" not in present:
        additions.append("ECONOMY_SHOP_ENABLED='true'")
    if "ECONOMY_SETTLEMENT_ACTIVATED_AT" not in present:
        timestamp = (now or (lambda: datetime.now(timezone.utc)))()
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("local settlement activation time must include a timezone")
        additions.append(
            f"ECONOMY_SETTLEMENT_ACTIVATED_AT='{timestamp.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')}'"
        )
    if not additions:
        return
    separator = "" if not existing or existing.endswith(("\n", "\r")) else "\n"
    path.write_text(
        existing + separator + "\n".join(additions) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env.dev"
    ensure_dev_env(env_path)
    print(
        f"Preserved existing settings and ensured local economy defaults in {env_path}."
    )

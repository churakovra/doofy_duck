from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Settings:
    environment: str
    platform_database_url: str
    economy_database_url: str
    telegram_bot_token: str
    access_token_private_key_b64: str
    access_token_key_id: str
    service_token: str
    refresh_cookie_secure: bool
    dev_auth_enabled: bool
    dev_auth_user_id: int
    economy_settlement_enabled: bool = False
    economy_settlement_activated_at: datetime | None = None
    economy_shop_enabled: bool = False
    platform_pool_size: int = 5
    platform_pool_max_overflow: int = 10
    platform_pool_timeout: float = 30.0
    economy_pool_size: int = 5
    economy_pool_max_overflow: int = 10
    economy_pool_timeout: float = 30.0

    def __post_init__(self) -> None:
        for name in ("platform", "economy"):
            size = getattr(self, f"{name}_pool_size")
            overflow = getattr(self, f"{name}_pool_max_overflow")
            timeout = getattr(self, f"{name}_pool_timeout")
            if size <= 0 or overflow < 0 or not math.isfinite(timeout) or timeout <= 0:
                raise RuntimeError(f"{name} pool requires size > 0, max overflow >= 0, and finite timeout > 0")

    @classmethod
    def from_env(cls) -> Settings:
        environment = os.getenv("DD_ENV", "development")
        dev_auth_enabled = _bool("DEV_AUTH_ENABLED", False)
        if environment == "production" and dev_auth_enabled:
            raise RuntimeError("DEV_AUTH_ENABLED cannot be enabled in production")
        if environment not in {"development", "test", "production"}:
            raise RuntimeError("DD_ENV must be development, test, or production")
        activated_at_value = os.getenv("ECONOMY_SETTLEMENT_ACTIVATED_AT", "").strip()
        try:
            activated_at = (
                datetime.fromisoformat(activated_at_value.replace("Z", "+00:00")) if activated_at_value else None
            )
        except ValueError as error:
            raise RuntimeError("ECONOMY_SETTLEMENT_ACTIVATED_AT must be an ISO 8601 timestamp") from error
        if activated_at is not None and (activated_at.tzinfo is None or activated_at.utcoffset() is None):
            raise RuntimeError("ECONOMY_SETTLEMENT_ACTIVATED_AT must include a timezone")
        return cls(
            environment=environment,
            platform_database_url=os.getenv(
                "PLATFORM_DATABASE_URL", "postgresql+psycopg://platform:platform@localhost/platform"
            ),
            economy_database_url=os.getenv(
                "ECONOMY_DATABASE_URL", "postgresql+psycopg://economy:economy@localhost/economy"
            ),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            access_token_private_key_b64=os.getenv("ACCESS_TOKEN_PRIVATE_KEY_B64", ""),
            access_token_key_id=os.getenv("ACCESS_TOKEN_KEY_ID", "dev-key"),
            service_token=os.getenv("CORE_TO_PLATFORM_TOKEN", ""),
            refresh_cookie_secure=environment == "production",
            dev_auth_enabled=dev_auth_enabled,
            dev_auth_user_id=int(os.getenv("DEV_AUTH_USER_ID", "100000001")),
            economy_settlement_enabled=_bool("ECONOMY_SETTLEMENT_ENABLED", False),
            economy_settlement_activated_at=activated_at,
            economy_shop_enabled=_bool("ECONOMY_SHOP_ENABLED", False),
            platform_pool_size=_int("PLATFORM_POOL_SIZE", 5),
            platform_pool_max_overflow=_int("PLATFORM_POOL_MAX_OVERFLOW", 10),
            platform_pool_timeout=_float("PLATFORM_POOL_TIMEOUT", 30.0),
            economy_pool_size=_int("ECONOMY_POOL_SIZE", 5),
            economy_pool_max_overflow=_int("ECONOMY_POOL_MAX_OVERFLOW", 10),
            economy_pool_timeout=_float("ECONOMY_POOL_TIMEOUT", 30.0),
        )

    def validate_runtime(self) -> None:
        if not self.access_token_private_key_b64:
            raise RuntimeError("ACCESS_TOKEN_PRIVATE_KEY_B64 is required")
        if not self.service_token:
            raise RuntimeError("CORE_TO_PLATFORM_TOKEN is required")
        if self.environment == "production" and (
            not self.telegram_bot_token
            or self.telegram_bot_token == "development-only-not-a-real-bot-token"
            or self.access_token_key_id.lower().startswith(("dev", "local", "dd-local"))
        ):
            raise RuntimeError("production requires a Telegram bot token and non-development signing key")
        if self.dev_auth_enabled and self.environment != "development":
            raise RuntimeError("DEV_AUTH_ENABLED is development-only")
        self.validate_settlement_config()

    def validate_settlement_config(self) -> None:
        if self.economy_settlement_enabled and self.economy_settlement_activated_at is None:
            raise RuntimeError("ECONOMY_SETTLEMENT_ACTIVATED_AT is required when settlement is enabled")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number") from error

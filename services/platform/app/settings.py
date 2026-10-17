from __future__ import annotations

import os
from dataclasses import dataclass


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

    @classmethod
    def from_env(cls) -> Settings:
        environment = os.getenv("DD_ENV", "development")
        dev_auth_enabled = _bool("DEV_AUTH_ENABLED", False)
        if environment == "production" and dev_auth_enabled:
            raise RuntimeError("DEV_AUTH_ENABLED cannot be enabled in production")
        if environment not in {"development", "test", "production"}:
            raise RuntimeError("DD_ENV must be development, test, or production")
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


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}

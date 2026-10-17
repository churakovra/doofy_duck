import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode

import pytest

from app.auth import TelegramInitDataError, verify_telegram_init_data
from app.tokens import AccessTokenError, Ed25519TokenIssuer, verify_access_token


def signed_init_data(bot_token: str, auth_date: int, user: str = '{"id":42}') -> str:
    fields = {"auth_date": str(auth_date), "query_id": "AAE", "user": user}
    data_check = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_telegram_init_data_requires_valid_signature_and_fresh_auth_date():
    bot_token = "test-bot-token"
    now = datetime.now(UTC)
    init_data = signed_init_data(bot_token, int(now.timestamp()))

    assert verify_telegram_init_data(init_data, bot_token, now=now).telegram_user_id == 42
    forged_fields = dict(parse_qsl(init_data))
    forged_fields["user"] = '{"id":43}'
    with pytest.raises(TelegramInitDataError):
        verify_telegram_init_data(urlencode(forged_fields), bot_token, now=now)
    stale = signed_init_data(bot_token, int((now - timedelta(hours=2)).timestamp()))
    with pytest.raises(TelegramInitDataError):
        verify_telegram_init_data(stale, bot_token, now=now)


def test_access_credentials_are_ed25519_signed_expiring_and_user_scoped():
    issuer = Ed25519TokenIssuer.generate(kid="test-key")
    now = datetime.now(UTC)
    token = issuer.issue("11111111-1111-4111-8111-111111111111", now=now)
    claims = verify_access_token(token, {"test-key": issuer.public_key}, now=now)

    assert claims.subject == "11111111-1111-4111-8111-111111111111"
    with pytest.raises(AccessTokenError):
        verify_access_token(token, {"test-key": Ed25519TokenIssuer.generate().public_key}, now=now)
    with pytest.raises(AccessTokenError):
        verify_access_token(token, {"test-key": issuer.public_key}, now=now + timedelta(minutes=11))


def test_production_rejects_dev_auth_and_local_signing_key(monkeypatch):
    from app.settings import Settings

    monkeypatch.setenv("DD_ENV", "production")
    monkeypatch.setenv("DEV_AUTH_ENABLED", "true")
    with pytest.raises(RuntimeError, match="cannot be enabled"):
        Settings.from_env()

    monkeypatch.setenv("DEV_AUTH_ENABLED", "false")
    monkeypatch.setenv("ACCESS_TOKEN_PRIVATE_KEY_B64", "local-private-key")
    monkeypatch.setenv("CORE_TO_PLATFORM_TOKEN", "local-service-token")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "development-only-not-a-real-bot-token")
    settings = Settings.from_env()
    with pytest.raises(RuntimeError, match="non-development signing key"):
        settings.validate_runtime()

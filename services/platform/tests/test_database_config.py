from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app import database
from app.settings import Settings
from app.tokens import Ed25519TokenIssuer


def test_pool_settings_configure_each_engine(monkeypatch):
    monkeypatch.setenv("PLATFORM_POOL_SIZE", "2")
    monkeypatch.setenv("PLATFORM_POOL_MAX_OVERFLOW", "3")
    monkeypatch.setenv("PLATFORM_POOL_TIMEOUT", "1.5")
    monkeypatch.setenv("ECONOMY_POOL_SIZE", "4")
    monkeypatch.setenv("ECONOMY_POOL_MAX_OVERFLOW", "0")
    monkeypatch.setenv("ECONOMY_POOL_TIMEOUT", "2")
    # Construct real QueuePools without requiring libpq or opening a database connection.
    monkeypatch.setattr(database, "create_engine", lambda url, **options: create_engine("sqlite:///test.db", **options))
    settings = Settings.from_env()
    database.configure_databases(
        settings.platform_database_url,
        settings.economy_database_url,
        platform_pool_size=settings.platform_pool_size,
        platform_max_overflow=settings.platform_pool_max_overflow,
        platform_pool_timeout=settings.platform_pool_timeout,
        economy_pool_size=settings.economy_pool_size,
        economy_max_overflow=settings.economy_pool_max_overflow,
        economy_pool_timeout=settings.economy_pool_timeout,
    )
    assert database.platform_engine.pool.size() == 2
    assert database.platform_engine.pool._max_overflow == 3
    assert database.platform_engine.pool._timeout == 1.5
    assert database.economy_engine.pool.size() == 4
    assert database.economy_engine.pool._max_overflow == 0
    assert database.economy_engine.pool._timeout == 2
    database.platform_engine.dispose()
    database.economy_engine.dispose()


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("PLATFORM_POOL_SIZE", "0"),
        ("ECONOMY_POOL_MAX_OVERFLOW", "-1"),
        ("ECONOMY_POOL_TIMEOUT", "nan"),
        ("PLATFORM_POOL_TIMEOUT", "inf"),
        ("PLATFORM_POOL_TIMEOUT", "0"),
        ("PLATFORM_POOL_SIZE", "invalid"),
    ],
)
def test_invalid_pool_settings_fail_before_startup(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError):
        Settings.from_env()


def test_router_registration_preserves_public_auth_guards(monkeypatch):
    issuer = Ed25519TokenIssuer.generate("test-key")
    key = base64.urlsafe_b64encode(issuer.private_key.private_bytes_raw()).rstrip(b"=").decode()
    monkeypatch.setenv("ACCESS_TOKEN_PRIVATE_KEY_B64", key)
    monkeypatch.setenv("CORE_TO_PLATFORM_TOKEN", "test-service-token")
    monkeypatch.setenv("PLATFORM_DATABASE_URL", "sqlite:///platform-test.db")
    monkeypatch.setenv("ECONOMY_DATABASE_URL", "sqlite:///economy-test.db")
    monkeypatch.delenv("ACCESS_TOKEN_PUBLIC_KEYS_JSON", raising=False)
    from app.main import create_app

    app = create_app(Settings.from_env())
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/.well-known/jwks.json").json()["keys"][0]["kid"] == "dev-key"
        for path in ("/api/v1/account", "/api/v1/wallets", "/api/v1/shop/catalog"):
            assert client.get(path).status_code == 401


def test_settlement_cli_uses_configured_economy_pool(monkeypatch):
    import sys

    from app.economy import settlement_cli

    monkeypatch.setattr(sys, "argv", ["settlement_cli", "worker"])
    monkeypatch.setenv("ECONOMY_DATABASE_URL", "postgresql+psycopg://user:pass@localhost/economy")
    monkeypatch.setenv("ECONOMY_POOL_SIZE", "3")
    monkeypatch.setenv("ECONOMY_POOL_MAX_OVERFLOW", "2")
    monkeypatch.setenv("ECONOMY_POOL_TIMEOUT", "1.5")
    monkeypatch.setenv("ECONOMY_SETTLEMENT_ENABLED", "false")
    created = []

    def make_engine(url, **options):
        created.append((url, options))
        return create_engine("sqlite:///test.db")

    monkeypatch.setattr(settlement_cli, "create_bounded_engine", make_engine)
    assert settlement_cli.main() == 2  # Disabled worker exits before it needs a connection.
    assert created == [
        (
            "postgresql+psycopg://user:pass@localhost/economy",
            {
                "pool_size": 3,
                "max_overflow": 2,
                "pool_timeout": 1.5,
            },
        )
    ]

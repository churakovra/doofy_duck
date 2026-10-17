from __future__ import annotations

import base64
import os
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from test_contracts import signed_init_data

from app.settings import Settings
from app.tokens import Ed25519TokenIssuer

PLATFORM_URL = os.getenv("PLATFORM_TEST_DATABASE_URL")
ECONOMY_URL = os.getenv("ECONOMY_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not (PLATFORM_URL and ECONOMY_URL), reason="PostgreSQL integration URLs are not configured"
)
for test_url in (PLATFORM_URL, ECONOMY_URL):
    if test_url and not urlsplit(test_url).path.rstrip("/").endswith("_test"):
        raise RuntimeError("PostgreSQL integration tests only accept dedicated *_test databases")


@pytest.fixture
def client(monkeypatch):
    issuer = Ed25519TokenIssuer.generate("integration-key")
    raw = issuer.private_key.private_bytes_raw()
    encoded = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    monkeypatch.setenv("DD_ENV", "test")
    monkeypatch.setenv("PLATFORM_DATABASE_URL", PLATFORM_URL)
    monkeypatch.setenv("ECONOMY_DATABASE_URL", ECONOMY_URL)
    monkeypatch.setenv("ACCESS_TOKEN_PRIVATE_KEY_B64", encoded)
    monkeypatch.setenv("ACCESS_TOKEN_KEY_ID", "integration-key")
    monkeypatch.setenv("CORE_TO_PLATFORM_TOKEN", "integration-core-token")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "integration-bot-token")
    monkeypatch.delenv("ACCESS_TOKEN_PUBLIC_KEYS_JSON", raising=False)

    from app import database
    from app.main import create_app

    database.configure_databases(PLATFORM_URL, ECONOMY_URL)
    database.PlatformBase.metadata.drop_all(database.platform_engine)
    database.EconomyBase.metadata.drop_all(database.economy_engine)
    database.PlatformBase.metadata.create_all(database.platform_engine)
    database.EconomyBase.metadata.create_all(database.economy_engine)
    app = create_app(Settings.from_env())
    with TestClient(app) as test_client:
        yield test_client
    database.PlatformBase.metadata.drop_all(database.platform_engine)
    database.EconomyBase.metadata.drop_all(database.economy_engine)
    database.platform_engine.dispose()
    database.economy_engine.dispose()


def test_telegram_login_issues_own_account_and_rotating_csrf_protected_session(client):
    now = datetime.now(UTC)
    init_data = signed_init_data("integration-bot-token", int(now.timestamp()))
    login = client.post("/api/v1/auth/telegram", json={"init_data": init_data})
    assert login.status_code == 200
    body = login.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 600
    refresh_cookie = client.cookies.get("dd_refresh")
    csrf_cookie = client.cookies.get("dd_csrf")
    assert refresh_cookie and csrf_cookie
    assert "httponly" in login.headers["set-cookie"].lower()

    account = client.get("/api/v1/account", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert account.status_code == 200
    assert account.json()["telegram_user_id"] == 42
    assert client.get("/api/v1/account").status_code == 401

    missing_csrf = client.post("/api/v1/auth/refresh")
    assert missing_csrf.status_code == 403
    rotated = client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf_cookie})
    assert rotated.status_code == 200
    assert rotated.json()["access_token"] != body["access_token"]
    new_refresh = client.cookies.get("dd_refresh")
    new_csrf = client.cookies.get("dd_csrf")
    assert new_refresh != refresh_cookie
    assert new_csrf != csrf_cookie

    replay = client.post(
        "/api/v1/auth/refresh",
        headers={"X-CSRF-Token": csrf_cookie},
        cookies={"dd_refresh": refresh_cookie, "dd_csrf": csrf_cookie},
    )
    assert replay.status_code == 401
    revoked_replacement = client.post(
        "/api/v1/auth/refresh",
        headers={"X-CSRF-Token": new_csrf},
        cookies={"dd_refresh": new_refresh, "dd_csrf": new_csrf},
    )
    assert revoked_replacement.status_code == 401


def test_valid_access_token_cannot_be_forged_for_another_account(client):
    first = client.post(
        "/api/v1/auth/telegram",
        json={"init_data": signed_init_data("integration-bot-token", int(datetime.now(UTC).timestamp()))},
    ).json()
    account = client.get("/api/v1/account", headers={"Authorization": f"Bearer {first['access_token']}"}).json()
    assert UUID(account["account_id"])
    assert client.get("/api/v1/account", headers={"Authorization": "Bearer forged"}).status_code == 401
    assert (
        client.get(
            "/api/v1/account",
            headers={
                "Authorization": f"Bearer {first['access_token']}",
                "X-Account-ID": "22222222-2222-4222-8222-222222222222",
            },
        ).json()["account_id"]
        == account["account_id"]
    )


def test_completion_inbox_authenticates_core_and_deduplicates_business_identity(client):
    event = {
        "event_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "type": "RunLifeCompleted.v1",
        "account_id": "11111111-1111-4111-8111-111111111111",
        "run_id": "22222222-2222-4222-8222-222222222222",
        "life_index": 0,
        "simulation_version": "1.3.0",
        "generator_version": "1.2.0",
        "config_id": "dd-v1-stepped-v1",
        "checkpoint_sequence": 8,
        "score": 4,
        "collections": {"FEATHER": 3, "GAME_STAR": 1},
        "reason": "death",
        "completed_at": "2026-10-17T10:00:00Z",
    }
    assert client.post("/internal/v1/run-completions", json=event).status_code == 401
    headers = {"Authorization": "Bearer integration-core-token"}
    first = client.post("/internal/v1/run-completions", json=event, headers=headers)
    repeated = client.post("/internal/v1/run-completions", json=event, headers=headers)
    assert first.status_code == 202 and first.json()["duplicate"] is False
    assert repeated.status_code == 202 and repeated.json()["duplicate"] is True
    conflict = {**event, "event_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "score": 5}
    assert client.post("/internal/v1/run-completions", json=conflict, headers=headers).status_code == 409

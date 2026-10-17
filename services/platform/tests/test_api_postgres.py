from __future__ import annotations

import base64
import json
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
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


def _login(client, telegram_user_id: int) -> tuple[str, UUID]:
    token = client.post(
        "/api/v1/auth/telegram",
        json={
            "init_data": signed_init_data(
                "integration-bot-token",
                int(datetime.now(UTC).timestamp()),
                user=f'{{"id":{telegram_user_id}}}',
            )
        },
    ).json()["access_token"]
    account = client.get("/api/v1/account", headers={"Authorization": f"Bearer {token}"}).json()
    return token, UUID(account["account_id"])


def _completion_event(
    *,
    account_id: UUID,
    run_id: UUID,
    life_index: int = 0,
    feathers: int = 0,
    stars: int = 0,
    completed_at: datetime | None = None,
    simulation_version: str = "1.3.0",
    generator_version: str = "1.2.0",
    config_id: str = "dd-v1-stepped-v1",
) -> dict[str, object]:
    return {
        "event_id": str(uuid5(NAMESPACE_URL, f"completion:{run_id}:{life_index}")),
        "type": "RunLifeCompleted.v1",
        "account_id": str(account_id),
        "run_id": str(run_id),
        "life_index": life_index,
        "simulation_version": simulation_version,
        "generator_version": generator_version,
        "config_id": config_id,
        "checkpoint_sequence": 8,
        "score": 4,
        "collections": {"FEATHER": feathers, "GAME_STAR": stars},
        "reason": "death",
        "completed_at": (completed_at or datetime.now(UTC)).isoformat(),
    }


def _accept_completion(client, event: dict[str, object]):
    response = client.post(
        "/internal/v1/run-completions", json=event, headers={"Authorization": "Bearer integration-core-token"}
    )
    assert response.status_code == 202, response.json()
    return response


def test_wallet_api_is_authenticated_account_owned_and_uses_decimal_strings(client):
    from app import database
    from app.economy.wallet.ledger import MAX_BALANCE, post_entry

    assert client.get("/api/v1/wallets").status_code == 401
    token, account_id = _login(client, 420001)
    headers = {"Authorization": f"Bearer {token}"}

    balances = client.get("/api/v1/wallets", headers=headers)
    assert balances.status_code == 200
    assert balances.json() == {
        "balances": [{"currency": "FEATHER", "balance": "0"}, {"currency": "GAME_STAR", "balance": "0"}]
    }

    with database.EconomySession.begin() as session:
        post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="large-credit",
            direction="credit",
            amount=MAX_BALANCE,
            source_kind="internal_test",
            source_reference="large-value",
            policy_version="test-policy-v1",
        )
        post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="later-credit",
            direction="debit",
            amount=1,
            source_kind="internal_test",
            source_reference="later-value",
            policy_version="test-policy-v1",
        )

    wallet = client.get("/api/v1/wallets", headers=headers)
    assert wallet.status_code == 200
    assert wallet.json()["balances"][0]["balance"] == str(MAX_BALANCE - 1)
    first_page = client.get("/api/v1/wallets/FEATHER/entries?limit=1", headers=headers)
    assert first_page.status_code == 200
    next_cursor = first_page.json()["next_cursor"]
    assert next_cursor
    second_page = client.get(f"/api/v1/wallets/FEATHER/entries?limit=1&cursor={next_cursor}", headers=headers)
    assert second_page.status_code == 200
    history = first_page.json()["entries"] + second_page.json()["entries"]
    assert {entry["delta"] for entry in history} == {"-1", str(MAX_BALANCE)}
    ordering_keys = [
        (datetime.fromisoformat(entry["created_at"].replace("Z", "+00:00")), UUID(entry["entry_id"]))
        for entry in history
    ]
    assert ordering_keys == sorted(ordering_keys, reverse=True)

    other_token, _ = _login(client, 420002)
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_wallet = client.get("/api/v1/wallets", headers=other_headers)
    assert other_wallet.status_code == 200
    assert other_wallet.json()["balances"][0]["balance"] == "0"
    assert client.get("/api/v1/wallets/FEATHER/entries?limit=100", headers=other_headers).json()["entries"] == []


def test_wallet_read_failure_is_not_reported_as_zero(client):
    from app import database

    token, _ = _login(client, 420010)

    def fail_wallet_query(_connection, _cursor, statement, parameters, _context, _executemany):
        if "from wallets" in statement.lower():
            raise OperationalError(statement, parameters, RuntimeError("private database detail"))

    sqlalchemy_event.listen(database.economy_engine, "before_cursor_execute", fail_wallet_query)
    try:
        response = client.get("/api/v1/wallets", headers={"Authorization": f"Bearer {token}"})
    finally:
        sqlalchemy_event.remove(database.economy_engine, "before_cursor_execute", fail_wallet_query)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "wallet_unavailable"
    assert "private database detail" not in response.text


@pytest.mark.parametrize(
    "cursor_payload",
    [
        {"created_at": 123, "entry_id": "00000000-0000-0000-0000-000000000001"},
        {"created_at": "2026-10-17T00:00:00+00:00", "entry_id": True},
        {"created_at": [], "entry_id": {}},
    ],
)
def test_wallet_history_rejects_malformed_cursor_values_as_bad_request(client, cursor_payload):
    encoded = base64.urlsafe_b64encode(json.dumps(cursor_payload).encode()).rstrip(b"=").decode()
    token, _ = _login(client, 420011)
    response = client.get(
        f"/api/v1/wallets/FEATHER/entries?cursor={encoded}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_cursor"


def test_completion_acceptance_stays_pending_and_status_is_owner_scoped(client):
    from app import database
    from app.economy.models import CompletionSettlement

    token, account_id = _login(client, 420003)
    other_token, _ = _login(client, 420004)
    event = _completion_event(account_id=account_id, run_id=UUID(int=421))
    accepted = _accept_completion(client, event)
    assert accepted.status_code == 202
    duplicate = _accept_completion(client, event)
    assert duplicate.status_code == 202 and duplicate.json()["duplicate"] is True
    with database.EconomySession() as session:
        assert session.scalar(select(func.count()).select_from(CompletionSettlement)) == 1
    from app.economy.settlement import process_settlement_batch

    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=client.app.state.settings, limit=10) == 0

    own = client.get(
        f"/api/v1/completions/{event['run_id']}/{event['life_index']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert own.status_code == 200
    assert own.json()["status"] == "pending"
    assert own.json()["reason"] == "settlement_disabled"
    foreign = client.get(
        f"/api/v1/completions/{event['run_id']}/{event['life_index']}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert foreign.status_code == 404
    assert client.get(f"/api/v1/completions/{event['run_id']}/{event['life_index']}").status_code == 401


def test_settlement_policy_caps_coins_and_keeps_legacy_stars_uncredited(client):
    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import process_settlement_batch
    from app.economy.wallet.models import Wallet

    token, account_id = _login(client, 420005)
    run_id = UUID(int=422)
    headers = {"Authorization": "Bearer integration-core-token"}
    late_life = _completion_event(
        account_id=account_id, run_id=run_id, life_index=1, feathers=20, stars=9, completed_at=datetime.now(UTC)
    )
    first_life = _completion_event(
        account_id=account_id, run_id=run_id, life_index=0, feathers=20, stars=9, completed_at=datetime.now(UTC)
    )
    assert client.post("/internal/v1/run-completions", json=late_life, headers=headers).status_code == 202

    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=settings, limit=10) == 1
    with database.EconomySession() as session:
        pending = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == run_id))
        assert pending is not None
        assert pending.status == "pending" and pending.reason == "waiting_for_prior_life"

    assert client.post("/internal/v1/run-completions", json=first_life, headers=headers).status_code == 202
    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=settings, limit=10) == 2
    with database.EconomySession() as session:
        settlements = session.scalars(
            select(CompletionSettlement)
            .where(CompletionSettlement.run_id == run_id)
            .order_by(CompletionSettlement.life_index)
        ).all()
        assert [(row.status, row.feathers_credited, row.stars_credited) for row in settlements] == [
            ("committed", 20, 0),
            ("committed", 10, 0),
        ]
        assert settlements[0].reason == "legacy_star_generation"
        assert (
            session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == "FEATHER"))
            == 30
        )

    status = client.get(f"/api/v1/completions/{run_id}/1", headers={"Authorization": f"Bearer {token}"})
    assert status.json()["credited"] == {"FEATHER": "10", "GAME_STAR": "0"}


def test_settlement_does_not_issue_pre_activation_or_unknown_simulation_facts(client):
    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import process_settlement_batch

    token, account_id = _login(client, 420006)
    cutoff = datetime.now(UTC)
    old_event = _completion_event(
        account_id=account_id,
        run_id=UUID(int=423),
        feathers=8,
        completed_at=cutoff - timedelta(days=1),
    )
    unknown_event = _completion_event(
        account_id=account_id,
        run_id=UUID(int=424),
        feathers=8,
        completed_at=cutoff + timedelta(seconds=1),
        simulation_version="99.0.0",
    )
    _accept_completion(client, old_event)
    _accept_completion(client, unknown_event)
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=cutoff,
    )
    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=settings, limit=10) == 1
    with database.EconomySession() as session:
        rows = session.scalars(select(CompletionSettlement).order_by(CompletionSettlement.run_id)).all()
        assert [(row.status, row.reason) for row in rows] == [
            ("pending", "settlement_disabled"),
            ("actionable_failure", "unsupported_simulation_identity"),
        ]
    old_status = client.get(
        f"/api/v1/completions/{old_event['run_id']}/0",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert old_status.status_code == 200
    assert old_status.json()["reason"] == "settlement_disabled"
    assert (
        client.get("/api/v1/wallets", headers={"Authorization": f"Bearer {token}"}).json()["balances"][0]["balance"]
        == "0"
    )


def test_live_batch_skips_waiting_first_run_instead_of_starving_later_runs(client):
    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import process_settlement_batch

    _, account_id = _login(client, 420012)
    blocked_run = UUID(int=400)
    eligible_run = UUID(int=401)
    _accept_completion(client, _completion_event(account_id=account_id, run_id=blocked_run, life_index=1, feathers=3))
    _accept_completion(client, _completion_event(account_id=account_id, run_id=eligible_run, feathers=4))
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )

    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=settings, limit=1) == 1
    with database.EconomySession() as session:
        blocked = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == blocked_run))
        eligible = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == eligible_run))
        assert blocked is not None and blocked.status == "pending"
        assert eligible is not None and eligible.status == "committed"


def test_run_reward_cap_lock_refreshes_cached_orm_state_after_other_worker_commits(client):
    from app import database
    from app.economy.models import RunRewardCap
    from app.economy.settlement import process_settlement_batch
    from app.economy.wallet.models import Wallet

    _, account_id = _login(client, 420013)
    run_id = UUID(int=402)
    _accept_completion(client, _completion_event(account_id=account_id, run_id=run_id, life_index=0, feathers=10))
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    with database.EconomySession.begin() as session:
        assert process_settlement_batch(session, settings=settings, limit=1) == 1

    _accept_completion(client, _completion_event(account_id=account_id, run_id=run_id, life_index=1, feathers=15))
    _accept_completion(client, _completion_event(account_id=account_id, run_id=run_id, life_index=2, feathers=10))
    with database.EconomySession.begin() as stale_session:
        cached_cap = stale_session.get(RunRewardCap, run_id)
        assert cached_cap is not None and cached_cap.feathers_credited == 10
        with database.EconomySession.begin() as fresh_session:
            assert process_settlement_batch(fresh_session, settings=settings, limit=1) == 1
        assert process_settlement_batch(stale_session, settings=settings, limit=1) == 1

    with database.EconomySession() as session:
        cap = session.get(RunRewardCap, run_id)
        balance = session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id))
        assert cap is not None and cap.feathers_credited == 30
        assert balance == 30


def test_backfill_cursor_advances_past_waiting_life_to_later_eligible_run(client):
    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import execute_historical_backfill, plan_historical_backfill

    _, account_id = _login(client, 420014)
    cutoff = datetime.now(UTC) + timedelta(minutes=1)
    blocked_run = UUID(int=390)
    eligible_run = UUID(int=391)
    _accept_completion(
        client,
        _completion_event(
            account_id=account_id,
            run_id=blocked_run,
            life_index=1,
            feathers=6,
            completed_at=cutoff - timedelta(days=1),
        ),
    )
    _accept_completion(
        client,
        _completion_event(
            account_id=account_id,
            run_id=eligible_run,
            feathers=7,
            completed_at=cutoff - timedelta(days=1),
        ),
    )
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=cutoff,
    )

    with database.EconomySession() as session:
        first_page = plan_historical_backfill(session, activated_at=cutoff, limit=1)
        assert first_page.waiting_count == 1
        assert first_page.has_more and first_page.next_cursor is not None
        second_page = plan_historical_backfill(
            session,
            activated_at=cutoff,
            limit=1,
            after=first_page.next_cursor,
        )
        assert second_page.completion_count == 1
        assert second_page.feathers_to_credit == 7

    with database.EconomySession.begin() as session:
        applied = execute_historical_backfill(
            session,
            settings=settings,
            limit=1,
            execute=True,
            after=first_page.next_cursor,
        )
        assert applied.feathers_credited == 7
    with database.EconomySession() as session:
        eligible = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == eligible_run))
        assert eligible is not None and eligible.status == "committed"


def test_supported_failure_retry_is_explicit_bounded_and_does_not_credit_inline(client, monkeypatch):
    from app import database
    from app.economy import settlement
    from app.economy.models import CompletionSettlement
    from app.economy.wallet.models import Wallet

    _, account_id = _login(client, 420015)
    cutoff = datetime.now(UTC) - timedelta(minutes=1)
    post_cutoff_run = UUID(int=392)
    pre_cutoff_run = UUID(int=393)
    _accept_completion(
        client,
        _completion_event(
            account_id=account_id,
            run_id=post_cutoff_run,
            feathers=8,
            simulation_version="99.0.0",
            completed_at=cutoff + timedelta(seconds=1),
        ),
    )
    _accept_completion(
        client,
        _completion_event(
            account_id=account_id,
            run_id=pre_cutoff_run,
            feathers=9,
            simulation_version="99.0.0",
            completed_at=cutoff - timedelta(seconds=1),
        ),
    )
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=cutoff,
    )
    with database.EconomySession.begin() as session:
        assert settlement.process_settlement_batch(session, settings=settings, limit=10) == 1
    monkeypatch.setattr(settlement, "SUPPORTED_SIMULATION_IDENTITY", ("99.0.0", "1.2.0", "dd-v1-stepped-v1"))

    with database.EconomySession.begin() as session:
        assert settlement.retry_supported_failures(session, settings=settings, limit=1).requeued == 1
    with database.EconomySession() as session:
        retry = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == post_cutoff_run))
        assert retry is not None and retry.status == "pending"
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) is None

    with database.EconomySession.begin() as session:
        assert settlement.process_settlement_batch(session, settings=settings, limit=1) == 1
    with database.EconomySession() as session:
        post = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == post_cutoff_run))
        old = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == pre_cutoff_run))
        assert post is not None and post.status == "committed" and post.feathers_credited == 8
        assert old is not None and old.status == "pending" and old.reason == "settlement_disabled"
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 8


def test_concurrent_settlement_workers_apply_one_business_effect(client):
    from concurrent.futures import ThreadPoolExecutor

    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import process_settlement_batch
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    _, account_id = _login(client, 420007)
    run_id = UUID(int=425)
    event = _completion_event(account_id=account_id, run_id=run_id, feathers=17)
    assert _accept_completion(client, event).status_code == 202
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )

    def work_once() -> int:
        with database.EconomySession.begin() as session:
            return process_settlement_batch(session, settings=settings, limit=1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        counts = list(pool.map(lambda _: work_once(), range(2)))
    with database.EconomySession() as session:
        settlement = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == run_id))
        assert settlement is not None and settlement.status == "committed"
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 17
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 1
    assert sum(counts) == 1


def test_concurrent_batches_lock_run_caps_and_wallets_in_global_order(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, local

    from app import database
    from app.economy.settlement import process_settlement_batch
    from app.economy.wallet.models import Wallet

    _, account_a = _login(client, 420016)
    _, account_b = _login(client, 420017)
    run_accounts = ((410, account_a), (411, account_b), (412, account_b), (413, account_a))
    for run_number, account_id in run_accounts:
        _accept_completion(client, _completion_event(account_id=account_id, run_id=UUID(int=run_number), feathers=5))
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    first_cap_lock = Barrier(2)
    observed = local()

    def synchronize_first_cap_lock(_connection, _cursor, statement, _parameters, _context, _executemany):
        if "from run_reward_caps" in statement.lower() and "for update" in statement.lower():
            if not getattr(observed, "synchronized", False):
                observed.synchronized = True
                first_cap_lock.wait(timeout=5)

    sqlalchemy_event.listen(database.economy_engine, "after_cursor_execute", synchronize_first_cap_lock)
    try:

        def work_once() -> int:
            with database.EconomySession.begin() as session:
                session.execute(select(func.set_config("lock_timeout", "3s", True)))
                return process_settlement_batch(session, settings=settings, limit=2)

        with ThreadPoolExecutor(max_workers=2) as pool:
            counts = list(pool.map(lambda _: work_once(), range(2)))
    finally:
        sqlalchemy_event.remove(database.economy_engine, "after_cursor_execute", synchronize_first_cap_lock)

    assert counts == [2, 2]
    with database.EconomySession() as session:
        balances = session.scalars(select(Wallet.balance).order_by(Wallet.account_id)).all()
        assert balances == [10, 10]


def test_settlement_rollback_can_be_retried_after_posting_was_flushed(client, monkeypatch):
    from app import database
    from app.economy import settlement
    from app.economy.models import CompletionSettlement
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    _, account_id = _login(client, 420008)
    run_id = UUID(int=426)
    event = _completion_event(account_id=account_id, run_id=run_id, feathers=13)
    _accept_completion(client, event)
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    original_post_entry = settlement.post_entry

    def post_then_crash(session, **kwargs):
        original_post_entry(session, **kwargs)
        raise RuntimeError("injected interruption before settlement commit")

    monkeypatch.setattr(settlement, "post_entry", post_then_crash)
    with pytest.raises(RuntimeError, match="injected interruption"):
        with database.EconomySession.begin() as session:
            settlement.process_settlement_batch(session, settings=settings, limit=1)

    with database.EconomySession() as session:
        pending = session.scalar(select(CompletionSettlement).where(CompletionSettlement.run_id == run_id))
        assert pending is not None and pending.status == "pending"
        assert session.scalar(select(func.count()).select_from(Wallet)) == 0
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 0

    monkeypatch.setattr(settlement, "post_entry", original_post_entry)
    with database.EconomySession.begin() as session:
        assert settlement.process_settlement_batch(session, settings=settings, limit=1) == 1
    with database.EconomySession() as session:
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 13
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 1


def test_historical_backfill_dry_run_is_read_only_and_execution_is_once_only(client):
    from app import database
    from app.economy.models import CompletionSettlement
    from app.economy.settlement import execute_historical_backfill, plan_historical_backfill
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    _, account_id = _login(client, 420009)
    cutoff = datetime.now(UTC)
    run_id = UUID(int=427)
    for life_index, feathers in enumerate((20, 20)):
        _accept_completion(
            client,
            _completion_event(
                account_id=account_id,
                run_id=run_id,
                life_index=life_index,
                feathers=feathers,
                stars=10,
                completed_at=cutoff - timedelta(days=2 - life_index),
            ),
        )
    settings = replace(
        client.app.state.settings,
        economy_settlement_enabled=True,
        economy_settlement_activated_at=cutoff,
    )
    with database.EconomySession() as session:
        plan = plan_historical_backfill(session, activated_at=cutoff, limit=100)
        assert plan.completion_count == 2
        assert plan.feathers_to_credit == 30
        assert plan.game_stars_to_credit == 0
        assert session.scalar(select(func.count()).select_from(Wallet)) == 0
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 0

    with database.EconomySession.begin() as session:
        executed = execute_historical_backfill(session, settings=settings, limit=100, execute=True)
        assert executed.feathers_credited == 30
    with database.EconomySession() as session:
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 30
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 2
        rows = session.scalars(select(CompletionSettlement).where(CompletionSettlement.run_id == run_id)).all()
        assert len(rows) == 2
        assert all(row.status == "committed" and row.stars_credited == 0 for row in rows)

    with database.EconomySession.begin() as session:
        replay = execute_historical_backfill(session, settings=settings, limit=100, execute=True)
        assert replay.feathers_credited == 0
    with database.EconomySession() as session:
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 30

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


@pytest.mark.parametrize("malformed", ["💥", "not-a-hash"])
def test_telegram_init_data_normalizes_malformed_hashes(malformed):
    now = datetime.now(UTC)
    with pytest.raises(TelegramInitDataError):
        verify_telegram_init_data(
            f"auth_date={int(now.timestamp())}&user=%7B%22id%22%3A42%7D&hash={malformed}", "token", now=now
        )


def test_telegram_init_data_rejects_unencodable_signed_field_and_preserves_unicode():
    now = datetime.now(UTC)
    with pytest.raises(TelegramInitDataError):
        verify_telegram_init_data(
            f"auth_date={int(now.timestamp())}&query_id=\ud800&user=%7B%22id%22%3A42%7D&hash=00", "token", now=now
        )

    valid = signed_init_data("token", int(now.timestamp()), '{"id":42,"first_name":"Иван"}')
    assert verify_telegram_init_data(valid, "token", now=now).first_name == "Иван"


@pytest.mark.parametrize("user_id", ["1e999", "-1e999"])
def test_telegram_init_data_normalizes_overflowing_user_ids(user_id):
    now = datetime.now(UTC)
    with pytest.raises(TelegramInitDataError):
        verify_telegram_init_data(
            f"auth_date={int(now.timestamp())}&user=%7B%22id%22%3A{user_id}%7D&hash=00", "token", now=now
        )


def test_platform_engine_bounds_postgres_waits_without_overriding_url_options(monkeypatch):
    from app.database import create_bounded_engine

    created = []

    def fake_create_engine(url, **kwargs):
        created.append((url, kwargs))
        return type("FakeEngine", (), {"url": url, "dispose": lambda self: None})()

    monkeypatch.setattr("app.database.create_engine", fake_create_engine)
    engine = create_bounded_engine("postgresql+psycopg://user:pass@localhost/db?options=-csearch_path%3Dtenant")
    assert "search_path=tenant" in engine.url.query["options"]
    assert "statement_timeout=30000" in engine.url.query["options"]
    assert "lock_timeout=5000" in engine.url.query["options"]
    assert engine.url.query["connect_timeout"] == "5"
    strict = create_bounded_engine(
        "postgresql+psycopg://user:pass@localhost/db?options=--statement_timeout%3D2000%20--lock_timeout%3D500&connect_timeout=2"
    )
    assert strict.url.query["options"] == "--statement_timeout=2000 --lock_timeout=500"
    assert strict.url.query["connect_timeout"] == "2"
    assert len(created) == 2


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


def test_settlement_requires_explicit_timezone_aware_activation_timestamp(monkeypatch):
    from app.settings import Settings

    monkeypatch.setenv("DD_ENV", "test")
    monkeypatch.setenv("ECONOMY_SETTLEMENT_ENABLED", "true")
    monkeypatch.delenv("ECONOMY_SETTLEMENT_ACTIVATED_AT", raising=False)
    with pytest.raises(RuntimeError, match="ACTIVATED_AT is required"):
        Settings.from_env().validate_settlement_config()

    monkeypatch.setenv("ECONOMY_SETTLEMENT_ACTIVATED_AT", "2026-10-17T12:00:00")
    with pytest.raises(RuntimeError, match="must include a timezone"):
        Settings.from_env()

    monkeypatch.setenv("ECONOMY_SETTLEMENT_ACTIVATED_AT", "2026-10-17T12:00:00Z")
    settings = Settings.from_env()
    assert settings.economy_settlement_enabled
    assert settings.economy_settlement_activated_at is not None


def test_settlement_policies_keep_legacy_stars_out_and_credit_new_stars_without_a_cap():
    from app.economy.settlement import historical_coin_reward, settlement_rewards

    legacy_identity = ("1.3.0", "1.2.0", "dd-v1-stepped-v1")
    star_identity = ("1.4.0", "1.3.0", "dd-v1-star-interval-v1")

    assert settlement_rewards(legacy_identity, feathers=20, game_stars=9, feathers_remaining=10) == (10, 0)
    assert settlement_rewards(star_identity, feathers=20, game_stars=9, feathers_remaining=10) == (10, 9)
    assert settlement_rewards(star_identity, feathers=20, game_stars=700, feathers_remaining=0) == (0, 700)
    assert historical_coin_reward(legacy_identity, 20, 10) == (10, "verified-pickups-v1")
    assert historical_coin_reward(star_identity, 20, 10) == (10, "verified-pickups-v2-historical-coins")
    assert historical_coin_reward(star_identity, 20, 0) == (0, "verified-pickups-v2-historical-coins")
    assert (
        settlement_rewards(("99.0.0", "1.2.0", "dd-v1-stepped-v1"), feathers=20, game_stars=9, feathers_remaining=10)
        is None
    )


def test_wallet_audit_cli_parser_supports_bounded_read_only_pages():
    from app.economy.settlement_cli import _parser

    args = _parser().parse_args(["wallet-audit", "--limit", "25", "--after", "00000000-0000-4000-8000-000000000001"])

    assert args.command == "wallet-audit"
    assert args.limit == 25
    assert args.after == "00000000-0000-4000-8000-000000000001"


def test_settlement_worker_retries_with_bounded_backoff_and_stops_cleanly():
    from threading import Event

    from sqlalchemy.exc import SQLAlchemyError

    from app.economy.settlement_cli import _parser, run_worker_loop

    args = _parser().parse_args(["worker", "--idle-seconds", "1", "--max-backoff-seconds", "2"])
    assert args.command == "worker"
    assert args.limit == 100

    stop_event = Event()
    outcomes = iter((SQLAlchemyError("offline"), SQLAlchemyError("offline"), 0))
    delays: list[float] = []
    errors: list[bool] = []

    def process_batch() -> int:
        result = next(outcomes)
        if isinstance(result, Exception):
            raise result
        return result

    def wait(seconds: float) -> bool:
        delays.append(seconds)
        if len(delays) == 3:
            stop_event.set()
        return stop_event.is_set()

    run_worker_loop(
        process_batch,
        stop_event=stop_event,
        idle_seconds=1,
        max_backoff_seconds=2,
        wait=wait,
        report_error=lambda: errors.append(True),
    )

    assert delays == [1, 2, 1]
    assert errors == [True, True]


def test_settlement_worker_waits_when_a_batch_only_finds_a_waiting_life():
    from threading import Event

    from app.economy.settlement import settlement_batch_progress
    from app.economy.settlement_cli import run_worker_loop

    stop_event = Event()
    waits: list[float] = []
    batch_reasons = ["waiting_for_prior_life"]

    def process_batch() -> int:
        assert batch_reasons == ["waiting_for_prior_life"]
        return settlement_batch_progress(["pending"])

    def wait(seconds: float) -> bool:
        waits.append(seconds)
        stop_event.set()
        return True

    run_worker_loop(
        process_batch,
        stop_event=stop_event,
        idle_seconds=2,
        max_backoff_seconds=30,
        wait=wait,
    )

    assert waits == [2]
    assert settlement_batch_progress(["pending", "committed"]) == 1


def test_purchase_rechecks_quote_expiry_after_wallet_lock_and_keeps_exact_replay_available(monkeypatch):
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace
    from uuid import uuid4

    from app.economy.shop.service import ShopError, _purchase_fingerprint, commit_purchase

    account_id = uuid4()
    quote_id = uuid4()
    purchase_id = uuid4()
    anchor = datetime(2026, 10, 17, 12, tzinfo=UTC)
    quote = SimpleNamespace(
        id=quote_id,
        account_id=account_id,
        item_type="skin",
        item_id="mint",
        currency="FEATHER",
        amount=20,
        catalog_version="cosmetics-v1",
        eligibility_version="telegram-account-v1",
        expires_at=anchor + timedelta(seconds=300),
    )
    request = SimpleNamespace(
        request_fingerprint=_purchase_fingerprint(account_id, quote_id),
        purchase_id=purchase_id,
    )
    purchase = SimpleNamespace(id=purchase_id, account_id=account_id, quote_id=quote_id)

    class Result:
        def __init__(self, value):
            self.value = value

        def scalar_one_or_none(self):
            return self.value

    class FakeSession:
        def __init__(self, *, replay=False):
            self.replay = replay
            self.wallet_locked = False

        def execute(self, statement):
            if statement.table.name == "shop_purchase_requests":
                return Result(None if self.replay else purchase_id)
            return Result(None)

        def scalar(self, statement):
            sql = str(statement)
            if "FROM shop_purchase_requests" in sql:
                return request
            if "FROM shop_quotes" in sql:
                return quote
            if "FROM wallets" in sql:
                self.wallet_locked = True
                return SimpleNamespace(balance=100)
            if "FROM shop_purchases" in sql:
                return purchase
            if "FROM cosmetic_entitlements" in sql:
                return None
            raise AssertionError(f"unexpected query: {sql}")

        def add(self, _value):
            pass

        def flush(self):
            pass

    fresh_session = FakeSession()
    expired = quote.expires_at + timedelta(seconds=1)

    class AdvancingDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return expired if fresh_session.wallet_locked else anchor + timedelta(seconds=299)

    from app.economy.shop import service

    monkeypatch.setattr(service, "datetime", AdvancingDateTime)
    ledger_posts: list[bool] = []
    monkeypatch.setattr(
        service, "post_entry", lambda *_args, **_kwargs: ledger_posts.append(True) or SimpleNamespace(id=uuid4())
    )

    with pytest.raises(ShopError, match="quote has expired"):
        commit_purchase(
            fresh_session,
            account_id=account_id,
            quote_id=quote_id,
            idempotency_key="same-purchase",
            enabled=True,
        )
    assert fresh_session.wallet_locked
    assert ledger_posts == []

    replay_session = FakeSession(replay=True)
    replay = commit_purchase(
        replay_session,
        account_id=account_id,
        quote_id=quote_id,
        idempotency_key="same-purchase",
        enabled=False,
        now=expired,
    )
    assert replay.replayed
    assert replay.purchase is purchase

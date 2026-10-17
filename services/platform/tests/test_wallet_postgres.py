from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, func, inspect, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

ECONOMY_URL = os.getenv("ECONOMY_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not ECONOMY_URL, reason="ECONOMY_TEST_DATABASE_URL is not configured")
MAX_INT64 = (1 << 63) - 1


@pytest.fixture
def wallet_store(monkeypatch):
    assert ECONOMY_URL is not None
    if not make_url(ECONOMY_URL).database.endswith("_test"):
        raise RuntimeError("wallet PostgreSQL tests only accept a dedicated *_test database")

    admin_engine = create_engine(ECONOMY_URL)
    schema = f"wallet_test_{uuid4().hex}"
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    scoped_url = make_url(ECONOMY_URL).set(query={**make_url(ECONOMY_URL).query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("ECONOMY_DATABASE_URL", scoped_url.render_as_string(hide_password=False).replace("%", "%%"))
    config_path = Path(__file__).resolve().parents[1] / "alembic-economy.ini"
    config = Config(str(config_path))
    try:
        command.upgrade(config, "0001_completion_inbox")
        migration_engine = create_engine(scoped_url)
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO completion_inbox "
                    "(id, event_id, run_id, life_index, payload, payload_hash) "
                    "VALUES (:id, :event_id, :run_id, 0, '{}'::jsonb, :payload_hash)"
                ),
                {
                    "id": str(uuid4()),
                    "event_id": str(uuid4()),
                    "run_id": str(uuid4()),
                    "payload_hash": "a" * 64,
                },
            )
        migration_engine.dispose()
        command.upgrade(config, "head")
        engine = create_engine(scoped_url)
        yield sessionmaker(engine, expire_on_commit=False), engine
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()
        if "engine" in locals():
            engine.dispose()


def test_wallet_migration_preserves_inbox_and_installs_wallet_schema(wallet_store):
    sessions, engine = wallet_store
    from app.economy.models import CompletionEvidence
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CompletionEvidence)) == 1
        assert session.scalar(select(func.count()).select_from(Wallet)) == 0
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 0
    with engine.connect() as connection:
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert revision == "0003_completion_settlement"


def test_credit_debit_replay_conflict_and_adjustment_link(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import IdempotencyConflict, post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    with sessions.begin() as session:
        original = post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="task:one",
            direction="credit",
            amount=100,
            source_kind="internal_test",
            source_reference="task-one",
            policy_version="test-policy-v1",
            correlation_reference="request-one",
        )
        replay = post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="task:one",
            direction="credit",
            amount=100,
            source_kind="internal_test",
            source_reference="task-one",
            policy_version="test-policy-v1",
            correlation_reference="request-one",
        )
        assert replay.id == original.id
        with pytest.raises(IdempotencyConflict):
            post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id="task:one",
                direction="credit",
                amount=101,
                source_kind="internal_test",
                source_reference="task-one",
                policy_version="test-policy-v1",
                correlation_reference="request-one",
            )
        debit = post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="purchase:one",
            direction="debit",
            amount=30,
            source_kind="internal_test",
            source_reference="purchase-one",
            policy_version="test-policy-v1",
        )
        adjustment = post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="adjustment:one",
            direction="credit",
            amount=5,
            source_kind="adjustment",
            source_reference="adjustment-one",
            policy_version="test-policy-v1",
            adjusts_entry_id=debit.id,
        )
        assert adjustment.adjusts_entry_id == debit.id
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 75
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 3


def test_replay_returns_original_entry_without_reapplying_old_balance(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import post_entry
    from app.economy.wallet.models import Wallet

    account_id = uuid4()
    args = {
        "account_id": account_id,
        "currency": "GAME_STAR",
        "operation_id": "credit:one",
        "direction": "credit",
        "amount": 10,
        "source_kind": "internal_test",
        "source_reference": "fact-one",
        "policy_version": "test-policy-v1",
    }
    with sessions.begin() as session:
        first = post_entry(session, **args)
        post_entry(
            session,
            account_id=account_id,
            currency="GAME_STAR",
            operation_id="debit:one",
            direction="debit",
            amount=4,
            source_kind="internal_test",
            source_reference="purchase-one",
            policy_version="test-policy-v1",
        )
        replay = post_entry(session, **args)
        assert replay.id == first.id
        assert replay.delta == 10
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 6


def test_concurrent_first_credits_create_one_wallet_and_preserve_both_entries(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    barrier = threading.Barrier(2)

    def credit(operation_id: str, amount: int) -> None:
        with sessions.begin() as session:
            barrier.wait(timeout=3)
            post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id=operation_id,
                direction="credit",
                amount=amount,
                source_kind="internal_test",
                source_reference=operation_id,
                policy_version="test-policy-v1",
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda values: credit(*values), [("credit-one", 7), ("credit-two", 11)]))
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Wallet)) == 1
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 18
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 2


def test_concurrent_debits_cannot_overspend(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import InsufficientFunds, post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    with sessions.begin() as session:
        post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="initial-credit",
            direction="credit",
            amount=10,
            source_kind="internal_test",
            source_reference="initial-credit",
            policy_version="test-policy-v1",
        )
    barrier = threading.Barrier(2)

    def debit(operation_id: str) -> bool:
        try:
            with sessions.begin() as session:
                barrier.wait(timeout=3)
                post_entry(
                    session,
                    account_id=account_id,
                    currency="FEATHER",
                    operation_id=operation_id,
                    direction="debit",
                    amount=7,
                    source_kind="internal_test",
                    source_reference=operation_id,
                    policy_version="test-policy-v1",
                )
            return True
        except InsufficientFunds:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        accepted = list(pool.map(debit, ["debit-one", "debit-two"]))
    with sessions() as session:
        assert sum(accepted) == 1
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 3
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 2


def test_locked_balance_refreshes_a_wallet_cached_before_another_commit(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import InsufficientFunds, post_entry
    from app.economy.wallet.models import Wallet

    account_id = uuid4()
    with sessions.begin() as session:
        post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="initial-credit",
            direction="credit",
            amount=10,
            source_kind="internal_test",
            source_reference="initial-credit",
            policy_version="test-policy-v1",
        )

    stale_session = sessions()
    try:
        with stale_session.begin():
            cached_wallet = stale_session.scalar(select(Wallet).where(Wallet.account_id == account_id))
            assert cached_wallet is not None and cached_wallet.balance == 10
            with sessions.begin() as concurrent_session:
                post_entry(
                    concurrent_session,
                    account_id=account_id,
                    currency="FEATHER",
                    operation_id="concurrent-debit",
                    direction="debit",
                    amount=7,
                    source_kind="internal_test",
                    source_reference="concurrent-debit",
                    policy_version="test-policy-v1",
                )
            with pytest.raises(InsufficientFunds):
                post_entry(
                    stale_session,
                    account_id=account_id,
                    currency="FEATHER",
                    operation_id="stale-debit",
                    direction="debit",
                    amount=7,
                    source_kind="internal_test",
                    source_reference="stale-debit",
                    policy_version="test-policy-v1",
                )
    finally:
        stale_session.close()
    with sessions() as session:
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 3


def test_concurrent_identical_operations_create_one_effect(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    barrier = threading.Barrier(2)

    def credit() -> UUID:
        with sessions.begin() as session:
            barrier.wait(timeout=3)
            entry = post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id="same-operation",
                direction="credit",
                amount=9,
                source_kind="internal_test",
                source_reference="same-reference",
                policy_version="test-policy-v1",
            )
            return entry.id

    with ThreadPoolExecutor(max_workers=2) as pool:
        entry_ids = list(pool.map(lambda _: credit(), range(2)))
    with sessions() as session:
        assert entry_ids[0] == entry_ids[1]
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == 9
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 1


def test_concurrent_conflicting_operation_identity_has_one_winner(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import IdempotencyConflict, post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    barrier = threading.Barrier(2)

    def credit(amount: int) -> str:
        try:
            with sessions.begin() as session:
                barrier.wait(timeout=3)
                post_entry(
                    session,
                    account_id=account_id,
                    currency="FEATHER",
                    operation_id="conflicting-operation",
                    direction="credit",
                    amount=amount,
                    source_kind="internal_test",
                    source_reference="same-reference",
                    policy_version="test-policy-v1",
                )
            return "committed"
        except IdempotencyConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(credit, [7, 11]))
    with sessions() as session:
        assert sorted(outcomes) == ["committed", "conflict"]
        balance = session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id))
        assert balance in {7, 11}
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 1


def test_invalid_amounts_overflow_and_caller_rollback_leave_no_partial_effect(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import BalanceOverflow, InsufficientFunds, InvalidWalletRequest, post_entry
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_id = uuid4()
    with sessions.begin() as session:
        for amount in (True, 1.0, 0, -1, MAX_INT64 + 1):
            with pytest.raises(InvalidWalletRequest):
                post_entry(
                    session,
                    account_id=account_id,
                    currency="FEATHER",
                    operation_id=f"invalid:{amount!r}",
                    direction="credit",
                    amount=amount,
                    source_kind="internal_test",
                    source_reference="invalid",
                    policy_version="test-policy-v1",
                )
        with pytest.raises(InsufficientFunds):
            post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id="empty-debit",
                direction="debit",
                amount=1,
                source_kind="internal_test",
                source_reference="empty-debit",
                policy_version="test-policy-v1",
            )
        assert session.scalar(select(func.count()).select_from(Wallet)) == 0

    with sessions.begin() as session:
        post_entry(
            session,
            account_id=account_id,
            currency="FEATHER",
            operation_id="max-credit",
            direction="credit",
            amount=MAX_INT64,
            source_kind="internal_test",
            source_reference="max-credit",
            policy_version="test-policy-v1",
        )
        with pytest.raises(BalanceOverflow):
            post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id="overflow-credit",
                direction="credit",
                amount=1,
                source_kind="internal_test",
                source_reference="overflow-credit",
                policy_version="test-policy-v1",
            )
    with sessions() as session:
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_id)) == MAX_INT64
        assert session.scalar(select(func.count()).select_from(WalletLedgerEntry)) == 1

    rolled_back_account = uuid4()
    with pytest.raises(RuntimeError, match="caller rollback"):
        with sessions.begin() as session:
            post_entry(
                session,
                account_id=rolled_back_account,
                currency="FEATHER",
                operation_id="rolled-back-credit",
                direction="credit",
                amount=3,
                source_kind="internal_test",
                source_reference="rollback",
                policy_version="test-policy-v1",
            )
            raise RuntimeError("caller rollback")
    with sessions() as session:
        rolled_back_wallets = session.scalar(
            select(func.count()).select_from(Wallet).where(Wallet.account_id == rolled_back_account)
        )
        assert rolled_back_wallets == 0


def test_adjustment_must_reference_entry_for_same_wallet(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import InvalidWalletRequest, post_entry

    with sessions.begin() as session:
        first = post_entry(
            session,
            account_id=uuid4(),
            currency="FEATHER",
            operation_id="credit-one",
            direction="credit",
            amount=5,
            source_kind="internal_test",
            source_reference="credit-one",
            policy_version="test-policy-v1",
        )
        with pytest.raises(InvalidWalletRequest):
            post_entry(
                session,
                account_id=uuid4(),
                currency="FEATHER",
                operation_id="adjustment-other-wallet",
                direction="credit",
                amount=1,
                source_kind="adjustment",
                source_reference="other-wallet-adjustment",
                policy_version="test-policy-v1",
                adjusts_entry_id=first.id,
            )


def test_ledger_rows_are_immutable_and_reconciliation_is_paged_read_only(wallet_store):
    sessions, engine = wallet_store
    from app.economy.wallet.ledger import post_entry, reconcile_wallets
    from app.economy.wallet.models import Wallet, WalletLedgerEntry

    account_ids = [UUID(int=1), UUID(int=2), UUID(int=3)]
    with sessions.begin() as session:
        for index, account_id in enumerate(account_ids, start=1):
            post_entry(
                session,
                account_id=account_id,
                currency="FEATHER",
                operation_id=f"credit-{index}",
                direction="credit",
                amount=index,
                source_kind="internal_test",
                source_reference=f"credit-{index}",
                policy_version="test-policy-v1",
            )
        session.execute(update(Wallet).where(Wallet.account_id == account_ids[1]).values(balance=99))

    with sessions() as session:
        statements: list[str] = []

        def capture_select(_connection, _cursor, statement, _parameters, _context, _executemany):
            normalized = statement.lstrip().lower()
            if normalized.startswith(("select", "with")):
                statements.append(normalized)

        event.listen(engine, "before_cursor_execute", capture_select)
        pages = []
        cursor = None
        try:
            while True:
                page = reconcile_wallets(session, limit=1, after_wallet_id=cursor)
                pages.extend(page.items)
                cursor = page.next_wallet_id
                if cursor is None:
                    break
        finally:
            event.remove(engine, "before_cursor_execute", capture_select)
        assert len(pages) == 3
        assert sum(item.balance != item.ledger_total for item in pages) == 1
        assert statements
        assert all("wallet_page" in statement and "wallet_id" in statement for statement in statements)
        ledger_indexes = {index["name"] for index in inspect(engine).get_indexes("wallet_ledger_entries")}
        assert "ix_wallet_ledger_wallet_id" in ledger_indexes
        before = session.scalar(select(Wallet.balance).where(Wallet.account_id == account_ids[1]))
        entry = session.scalar(select(WalletLedgerEntry).limit(1))
        with pytest.raises(DBAPIError):
            session.execute(update(WalletLedgerEntry).where(WalletLedgerEntry.id == entry.id).values(delta=999))
        session.rollback()
        assert session.scalar(select(Wallet.balance).where(Wallet.account_id == account_ids[1])) == before == 99


def test_currency_and_adjustment_constraints_reject_untrusted_values(wallet_store):
    sessions, _ = wallet_store
    from app.economy.wallet.ledger import InvalidWalletRequest, post_entry

    with sessions.begin() as session:
        for currency in ("XTR", "feather", "GAME_STAR "):
            with pytest.raises(InvalidWalletRequest):
                post_entry(
                    session,
                    account_id=uuid4(),
                    currency=currency,
                    operation_id="invalid-currency",
                    direction="credit",
                    amount=1,
                    source_kind="internal_test",
                    source_reference="invalid-currency",
                    policy_version="test-policy-v1",
                )

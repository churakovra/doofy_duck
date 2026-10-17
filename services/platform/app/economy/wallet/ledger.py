from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.economy.wallet.models import Wallet, WalletCurrency, WalletLedgerEntry

MAX_BALANCE = (1 << 63) - 1
Direction = Literal["credit", "debit"]


class WalletError(Exception):
    """Base error for internal wallet operations."""


class InvalidWalletRequest(WalletError, ValueError):
    """The internal operation does not satisfy the wallet contract."""


class IdempotencyConflict(WalletError):
    """An operation identity was reused with different semantic input."""


class InsufficientFunds(WalletError):
    """A debit would make the wallet balance negative."""


class BalanceOverflow(WalletError):
    """A credit would exceed the signed 64-bit balance limit."""


@dataclass(frozen=True)
class WalletAuditItem:
    wallet_id: UUID
    account_id: UUID
    currency: WalletCurrency
    balance: int
    ledger_total: int

    @property
    def discrepancy(self) -> int:
        return self.balance - self.ledger_total


@dataclass(frozen=True)
class WalletAuditPage:
    items: tuple[WalletAuditItem, ...]
    next_wallet_id: UUID | None


def post_entry(
    session: Session,
    *,
    account_id: UUID,
    currency: WalletCurrency | str,
    operation_id: str,
    direction: Direction,
    amount: int,
    source_kind: str,
    source_reference: str,
    policy_version: str,
    correlation_reference: str | None = None,
    adjusts_entry_id: UUID | None = None,
) -> WalletLedgerEntry:
    """Apply one idempotent entry within the caller's current transaction."""
    currency_value = _currency_value(currency)
    _require_uuid(account_id, "account_id")
    _require_text(operation_id, "operation_id", 160)
    _require_text(source_kind, "source_kind", 64)
    _require_text(source_reference, "source_reference", 200)
    _require_text(policy_version, "policy_version", 64)
    if correlation_reference is not None:
        _require_text(correlation_reference, "correlation_reference", 200)
    if type(amount) is not int or amount < 1 or amount > MAX_BALANCE:
        raise InvalidWalletRequest("amount must be a positive signed 64-bit integer")
    if direction not in ("credit", "debit"):
        raise InvalidWalletRequest("direction must be credit or debit")
    if adjusts_entry_id is not None:
        _require_uuid(adjusts_entry_id, "adjusts_entry_id")

    fingerprint = _request_fingerprint(
        account_id=account_id,
        currency=currency_value,
        direction=direction,
        amount=amount,
        source_kind=source_kind,
        source_reference=source_reference,
        policy_version=policy_version,
        correlation_reference=correlation_reference,
        adjusts_entry_id=adjusts_entry_id,
    )

    adjusted: WalletLedgerEntry | None = None
    if adjusts_entry_id is not None:
        adjusted = session.scalar(select(WalletLedgerEntry).where(WalletLedgerEntry.id == adjusts_entry_id))
        if adjusted is None or adjusted.account_id != account_id or adjusted.currency != currency_value:
            raise InvalidWalletRequest("adjustment must reference an entry for the same account and currency")

    wallet_statement = (
        select(Wallet)
        .where(Wallet.account_id == account_id, Wallet.currency == currency_value)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    wallet = session.scalar(wallet_statement)
    if wallet is None:
        if direction == "debit":
            raise InsufficientFunds("wallet balance is zero")
        session.execute(
            insert(Wallet)
            .values(account_id=account_id, currency=currency_value, balance=0)
            .on_conflict_do_nothing(index_elements=[Wallet.account_id, Wallet.currency])
        )
        wallet = session.scalar(wallet_statement)
        if wallet is None:
            raise WalletError("wallet could not be created or loaded")

    existing = session.scalar(
        select(WalletLedgerEntry).where(
            WalletLedgerEntry.account_id == account_id,
            WalletLedgerEntry.currency == currency_value,
            WalletLedgerEntry.operation_id == operation_id,
        )
    )
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise IdempotencyConflict("operation identity was already used with different input")
        return existing

    if adjusted is not None and adjusted.wallet_id != wallet.id:
        raise InvalidWalletRequest("adjustment must reference an entry for the same wallet")

    delta = amount if direction == "credit" else -amount
    next_balance = wallet.balance + delta
    if next_balance < 0:
        raise InsufficientFunds("wallet balance is insufficient")
    if next_balance > MAX_BALANCE:
        raise BalanceOverflow("wallet balance exceeds signed 64-bit range")

    wallet.balance = next_balance
    wallet.updated_at = func.now()
    entry = WalletLedgerEntry(
        wallet_id=wallet.id,
        account_id=account_id,
        currency=currency_value,
        operation_id=operation_id,
        request_fingerprint=fingerprint,
        delta=delta,
        source_kind=source_kind,
        source_reference=source_reference,
        policy_version=policy_version,
        correlation_reference=correlation_reference,
        adjusts_entry_id=adjusts_entry_id,
    )
    session.add(entry)
    session.flush()
    return entry


def reconcile_wallets(
    session: Session,
    *,
    limit: int = 100,
    after_wallet_id: UUID | None = None,
) -> WalletAuditPage:
    """Return one read-only reconciliation page from a single SQL snapshot."""
    if type(limit) is not int or not 1 <= limit <= 500:
        raise InvalidWalletRequest("limit must be an integer from 1 to 500")
    if after_wallet_id is not None:
        _require_uuid(after_wallet_id, "after_wallet_id")

    wallet_page_select = (
        select(Wallet.id, Wallet.account_id, Wallet.currency, Wallet.balance).order_by(Wallet.id).limit(limit + 1)
    )
    if after_wallet_id is not None:
        wallet_page_select = wallet_page_select.where(Wallet.id > after_wallet_id)
    wallet_page = wallet_page_select.cte("wallet_page")

    ledger_totals = (
        select(
            WalletLedgerEntry.wallet_id.label("wallet_id"),
            func.sum(WalletLedgerEntry.delta).label("ledger_total"),
        )
        .where(WalletLedgerEntry.wallet_id.in_(select(wallet_page.c.id)))
        .group_by(WalletLedgerEntry.wallet_id)
        .subquery()
    )
    statement = (
        select(
            wallet_page.c.id,
            wallet_page.c.account_id,
            wallet_page.c.currency,
            wallet_page.c.balance,
            func.coalesce(ledger_totals.c.ledger_total, 0).label("ledger_total"),
        )
        .select_from(wallet_page.outerjoin(ledger_totals, ledger_totals.c.wallet_id == wallet_page.c.id))
        .order_by(wallet_page.c.id)
    )

    rows = session.execute(statement).all()
    has_more = len(rows) > limit
    visible_rows = rows[:limit]
    items = tuple(
        WalletAuditItem(
            wallet_id=row.id,
            account_id=row.account_id,
            currency=WalletCurrency(row.currency),
            balance=row.balance,
            ledger_total=int(row.ledger_total),
        )
        for row in visible_rows
    )
    next_wallet_id = items[-1].wallet_id if has_more and items else None
    return WalletAuditPage(items=items, next_wallet_id=next_wallet_id)


def _currency_value(currency: WalletCurrency | str) -> str:
    try:
        return WalletCurrency(currency).value
    except (TypeError, ValueError) as error:
        raise InvalidWalletRequest("currency must be FEATHER or GAME_STAR") from error


def _require_uuid(value: UUID, name: str) -> None:
    if not isinstance(value, UUID):
        raise InvalidWalletRequest(f"{name} must be a UUID")


def _require_text(value: str, name: str, maximum_length: int) -> None:
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > maximum_length:
        raise InvalidWalletRequest(f"{name} must be nonempty, trimmed text of at most {maximum_length} characters")


def _request_fingerprint(
    *,
    account_id: UUID,
    currency: str,
    direction: Direction,
    amount: int,
    source_kind: str,
    source_reference: str,
    policy_version: str,
    correlation_reference: str | None,
    adjusts_entry_id: UUID | None,
) -> str:
    canonical = {
        "account_id": str(account_id),
        "currency": currency,
        "direction": direction,
        "amount": amount,
        "source_kind": source_kind,
        "source_reference": source_reference,
        "policy_version": policy_version,
        "correlation_reference": correlation_reference,
        "adjusts_entry_id": str(adjusts_entry_id) if adjusts_entry_id is not None else None,
    }
    encoded = json.dumps(canonical, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import secrets
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from sqlalchemy import func, literal, or_, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app import database
from app.auth import TelegramIdentity, TelegramInitDataError, verify_telegram_init_data
from app.economy.inventory import decode_inventory_cursor, ensure_starter_state, list_inventory
from app.economy.models import CompletionEvidence, CompletionSettlement
from app.economy.settlement import enqueue_settlement
from app.economy.shop.catalog import OFFERS_BY_ID, public_catalog
from app.economy.shop.models import CosmeticEntitlement, CosmeticEquipment, ShopPurchase, ShopPurchaseRequest
from app.economy.shop.service import ShopError, commit_purchase, make_quote, serialize_purchase, serialize_quote
from app.economy.wallet.models import Wallet, WalletCurrency, WalletLedgerEntry
from app.platform.models import Account, RefreshSession
from app.request_logging import configure_json_logger, install_request_logging
from app.schemas import (
    AccessResponse,
    AccountResponse,
    CompletionSettlementResponse,
    DevAuthRequest,
    EquipmentUpdateRequest,
    RunLifeCompleted,
    ShopPurchaseRequestBody,
    ShopQuoteRequest,
    TelegramAuthRequest,
    WalletBalanceItem,
    WalletBalancesResponse,
    WalletEntryResponse,
    WalletHistoryResponse,
)
from app.settings import Settings
from app.tokens import ACCESS_TTL_SECONDS, AccessTokenError, Ed25519TokenIssuer, TokenClaims, verify_access_token

logger = logging.getLogger("doofy.platform")
configure_json_logger(logger)
REFRESH_COOKIE = "dd_refresh"
CSRF_COOKIE = "dd_csrf"
REFRESH_TTL = timedelta(days=30)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _decode_raw_private(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise RuntimeError("ACCESS_TOKEN_PRIVATE_KEY_B64 must be base64url") from exc


def _payload_hash(event: RunLifeCompleted) -> tuple[dict[str, Any], str]:
    payload = event.model_dump(mode="json")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return payload, hashlib.sha256(canonical.encode()).hexdigest()


def _encode_wallet_cursor(created_at: datetime, entry_id: uuid.UUID) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "entry_id": str(entry_id)}, sort_keys=True, separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_wallet_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    if not value or len(value) > 512:
        raise ValueError("invalid cursor")
    try:
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(payload, dict):
            raise ValueError("invalid cursor")
        if not isinstance(payload.get("created_at"), str) or not isinstance(payload.get("entry_id"), str):
            raise ValueError("invalid cursor")
        created_at = datetime.fromisoformat(payload["created_at"])
        entry_id = uuid.UUID(payload["entry_id"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ValueError("invalid cursor") from error
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("invalid cursor")
    return created_at, entry_id


def _encode_shop_cursor(created_at: datetime, purchase_id: uuid.UUID) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "purchase_id": str(purchase_id)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_shop_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    if not value or len(value) > 512:
        raise ValueError("invalid cursor")
    try:
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(payload, dict) or set(payload) != {"created_at", "purchase_id"}:
            raise ValueError("invalid cursor")
        if not isinstance(payload["created_at"], str) or not isinstance(payload["purchase_id"], str):
            raise ValueError("invalid cursor")
        created_at = datetime.fromisoformat(payload["created_at"])
        purchase_id = uuid.UUID(payload["purchase_id"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ValueError("invalid cursor") from error
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("invalid cursor")
    return created_at, purchase_id


def _shop_error(error: ShopError) -> HTTPException:
    detail: dict[str, object] = {"code": error.code, "message": error.message}
    if error.current is not None:
        detail["current"] = error.current
    return HTTPException(status_code=error.status_code, detail=detail)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    config.validate_runtime()
    database.configure_databases(config.platform_database_url, config.economy_database_url)
    issuer = Ed25519TokenIssuer.from_raw_private_key(
        config.access_token_key_id, _decode_raw_private(config.access_token_private_key_b64)
    )
    public_keys = {issuer.key_id: issuer.public_key}
    configured_keys = json.loads(os.getenv("ACCESS_TOKEN_PUBLIC_KEYS_JSON", "{}"))
    if not isinstance(configured_keys, dict):
        raise RuntimeError("ACCESS_TOKEN_PUBLIC_KEYS_JSON must be a JSON object")
    for key_id, encoded in configured_keys.items():
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        if len(raw) != 32:
            raise RuntimeError(f"public key {key_id!r} must be 32 raw Ed25519 bytes")
        public_keys[key_id] = Ed25519PublicKey.from_public_bytes(raw)

    app = FastAPI(title="Doofy Duck Platform", version="1.0.0")
    app.state.settings = config
    app.state.issuer = issuer
    app.state.public_keys = public_keys
    install_request_logging(app, logger)

    def get_platform_db() -> Iterator[Session]:
        yield from database.platform_session()

    def get_economy_db() -> Iterator[Session]:
        yield from database.economy_session()

    def current_claims(authorization: Annotated[str | None, Header()] = None) -> TokenClaims:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="unauthorized")
        try:
            return verify_access_token(authorization[7:], app.state.public_keys)
        except AccessTokenError:
            raise HTTPException(status_code=401, detail="unauthorized") from None

    def account_for(identity: TelegramIdentity, db: Session) -> Account:
        statement = (
            insert(Account)
            .values(
                id=uuid.uuid4(),
                telegram_user_id=identity.telegram_user_id,
                first_name=identity.first_name,
                username=identity.username,
            )
            .on_conflict_do_update(
                index_elements=[Account.telegram_user_id],
                set_={"first_name": identity.first_name, "username": identity.username},
            )
            .returning(Account)
        )
        return db.execute(statement).scalar_one()

    def set_session_cookies(response: Response, refresh: str, csrf: str) -> None:
        response.set_cookie(
            REFRESH_COOKIE,
            refresh,
            httponly=True,
            secure=config.refresh_cookie_secure,
            samesite="lax",
            path="/api/v1/auth",
            max_age=int(REFRESH_TTL.total_seconds()),
        )
        response.set_cookie(
            CSRF_COOKIE,
            csrf,
            httponly=False,
            secure=config.refresh_cookie_secure,
            samesite="lax",
            path="/",
            max_age=int(REFRESH_TTL.total_seconds()),
        )

    def issue_session(
        account: Account, db: Session, response: Response, *, family_id: uuid.UUID | None = None
    ) -> AccessResponse:
        now = datetime.now(UTC)
        refresh = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        db.add(
            RefreshSession(
                family_id=family_id or uuid.uuid4(),
                account_id=account.id,
                refresh_hash=hashlib.sha256(refresh.encode()).hexdigest(),
                csrf_hash=hashlib.sha256(csrf.encode()).hexdigest(),
                expires_at=now + REFRESH_TTL,
            )
        )
        db.commit()
        set_session_cookies(response, refresh, csrf)
        return AccessResponse(access_token=issuer.issue(str(account.id), now=now), expires_in=ACCESS_TTL_SECONDS)

    def csrf_valid(request: Request, csrf_header: str | None) -> bool:
        csrf_cookie = request.cookies.get(CSRF_COOKIE)
        return bool(csrf_cookie and csrf_header and hmac.compare_digest(csrf_cookie, csrf_header))

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def ready(
        platform_db: Session = Depends(get_platform_db), economy_db: Session = Depends(get_economy_db)
    ) -> dict[str, str]:
        try:
            platform_db.execute(text("SELECT 1"))
            economy_db.execute(text("SELECT 1"))
        except Exception:
            logger.warning("readiness_failed database_connectivity=true")
            raise HTTPException(status_code=503, detail="not ready") from None
        return {"status": "ready"}

    @app.get("/.well-known/jwks.json")
    def jwks() -> dict[str, list[dict[str, str]]]:
        return {
            "keys": [
                {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "use": "sig",
                    "alg": "EdDSA",
                    "kid": issuer.key_id,
                    "x": _b64(issuer.public_key_bytes()),
                }
            ]
        }

    @app.post("/api/v1/auth/telegram", response_model=AccessResponse)
    def telegram_login(
        body: TelegramAuthRequest, response: Response, db: Session = Depends(get_platform_db)
    ) -> AccessResponse:
        try:
            identity = verify_telegram_init_data(body.init_data, config.telegram_bot_token)
        except TelegramInitDataError:
            raise HTTPException(status_code=401, detail="unauthorized") from None
        account = account_for(identity, db)
        return issue_session(account, db, response)

    @app.post("/api/v1/auth/dev", response_model=AccessResponse)
    def development_login(
        body: DevAuthRequest, response: Response, db: Session = Depends(get_platform_db)
    ) -> AccessResponse:
        if config.environment != "development" or not config.dev_auth_enabled:
            raise HTTPException(status_code=404, detail="not found")
        identity = TelegramIdentity(
            body.telegram_user_id, "Development player", None, int(datetime.now(UTC).timestamp())
        )
        account = account_for(identity, db)
        return issue_session(account, db, response)

    @app.post("/api/v1/auth/refresh", response_model=AccessResponse)
    def refresh(
        request: Request,
        response: Response,
        x_csrf_token: Annotated[str | None, Header()] = None,
        db: Session = Depends(get_platform_db),
    ) -> AccessResponse:
        raw_refresh = request.cookies.get(REFRESH_COOKIE)
        if not raw_refresh or not csrf_valid(request, x_csrf_token):
            raise HTTPException(status_code=403, detail="csrf check failed")
        refresh_hash = hashlib.sha256(raw_refresh.encode()).hexdigest()
        current = db.execute(
            select(RefreshSession).where(RefreshSession.refresh_hash == refresh_hash).with_for_update()
        ).scalar_one_or_none()
        if current is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        csrf_hash = hashlib.sha256(csrf_cookie.encode()).hexdigest()
        if not hmac.compare_digest(current.csrf_hash, csrf_hash):
            raise HTTPException(status_code=403, detail="csrf check failed")
        if current.revoked:
            db.execute(update(RefreshSession).where(RefreshSession.family_id == current.family_id).values(revoked=True))
            db.commit()
            raise HTTPException(status_code=401, detail="unauthorized")
        now = datetime.now(UTC)
        if current.expires_at <= now:
            current.revoked = True
            db.commit()
            raise HTTPException(status_code=401, detail="unauthorized")
        current.revoked = True
        account = db.get(Account, current.account_id)
        if account is None:
            db.commit()
            raise HTTPException(status_code=401, detail="unauthorized")
        return issue_session(account, db, response, family_id=current.family_id)

    @app.post("/api/v1/auth/logout", status_code=204)
    def logout(
        request: Request,
        response: Response,
        x_csrf_token: Annotated[str | None, Header()] = None,
        db: Session = Depends(get_platform_db),
    ) -> Response:
        if not csrf_valid(request, x_csrf_token):
            raise HTTPException(status_code=403, detail="csrf check failed")
        raw_refresh = request.cookies.get(REFRESH_COOKIE)
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        if raw_refresh:
            session_row = db.execute(
                select(RefreshSession).where(
                    RefreshSession.refresh_hash == hashlib.sha256(raw_refresh.encode()).hexdigest()
                )
            ).scalar_one_or_none()
            if session_row and hmac.compare_digest(
                session_row.csrf_hash, hashlib.sha256(csrf_cookie.encode()).hexdigest()
            ):
                session_row.revoked = True
                db.commit()
        response.delete_cookie(
            REFRESH_COOKIE, path="/api/v1/auth", secure=config.refresh_cookie_secure, httponly=True, samesite="lax"
        )
        response.delete_cookie(
            CSRF_COOKIE, path="/", secure=config.refresh_cookie_secure, httponly=False, samesite="lax"
        )
        response.status_code = 204
        return response

    @app.get("/api/v1/account", response_model=AccountResponse)
    def own_account(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_platform_db)
    ) -> AccountResponse:
        account = db.get(Account, uuid.UUID(claims.subject))
        if account is None:
            raise HTTPException(status_code=404, detail="account not found")
        return AccountResponse(
            account_id=account.id, telegram_user_id=account.telegram_user_id, created_at=account.created_at
        )

    @app.get("/api/v1/wallets", response_model=WalletBalancesResponse)
    def own_wallets(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_economy_db)
    ) -> WalletBalancesResponse:
        account_id = uuid.UUID(claims.subject)
        try:
            wallets = db.scalars(select(Wallet).where(Wallet.account_id == account_id)).all()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("wallet_read_failed endpoint=balances")
            raise HTTPException(
                status_code=503, detail={"code": "wallet_unavailable", "message": "wallet is unavailable"}
            ) from None
        balances = {wallet.currency: wallet.balance for wallet in wallets}
        return WalletBalancesResponse(
            balances=[
                WalletBalanceItem(currency=currency.value, balance=str(balances.get(currency.value, 0)))
                for currency in WalletCurrency
            ]
        )

    @app.get("/api/v1/wallets/{currency}/entries", response_model=WalletHistoryResponse)
    def own_wallet_history(
        currency: WalletCurrency,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> WalletHistoryResponse:
        account_id = uuid.UUID(claims.subject)
        statement = select(WalletLedgerEntry).where(
            WalletLedgerEntry.account_id == account_id,
            WalletLedgerEntry.currency == currency.value,
        )
        if cursor is not None:
            try:
                created_at, entry_id = _decode_wallet_cursor(cursor)
            except ValueError:
                raise HTTPException(
                    status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
                ) from None
            statement = statement.where(
                tuple_(WalletLedgerEntry.created_at, WalletLedgerEntry.id)
                < tuple_(literal(created_at), literal(entry_id))
            )
        statement = statement.order_by(WalletLedgerEntry.created_at.desc(), WalletLedgerEntry.id.desc()).limit(
            limit + 1
        )
        try:
            rows = db.scalars(statement).all()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("wallet_read_failed endpoint=history")
            raise HTTPException(
                status_code=503, detail={"code": "wallet_unavailable", "message": "wallet is unavailable"}
            ) from None
        has_more = len(rows) > limit
        visible = rows[:limit]
        entries = [
            WalletEntryResponse(
                entry_id=row.id,
                currency=currency.value,
                operation_id=row.operation_id,
                delta=str(row.delta),
                source_kind=row.source_kind,
                source_reference=row.source_reference,
                policy_version=row.policy_version,
                correlation_reference=row.correlation_reference,
                created_at=row.created_at,
            )
            for row in visible
        ]
        next_cursor = _encode_wallet_cursor(visible[-1].created_at, visible[-1].id) if has_more and visible else None
        return WalletHistoryResponse(entries=entries, next_cursor=next_cursor)

    @app.get(
        "/api/v1/completions/{run_id}/{life_index}",
        response_model=CompletionSettlementResponse,
    )
    def own_completion_settlement(
        run_id: uuid.UUID,
        life_index: int,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> CompletionSettlementResponse:
        if life_index < 0:
            raise HTTPException(status_code=422, detail="invalid life index")
        account_id = uuid.UUID(claims.subject)
        try:
            result = db.execute(
                select(CompletionEvidence, CompletionSettlement)
                .outerjoin(CompletionSettlement, CompletionSettlement.event_id == CompletionEvidence.event_id)
                .where(
                    CompletionEvidence.run_id == run_id,
                    CompletionEvidence.life_index == life_index,
                    CompletionEvidence.payload["account_id"].as_string() == str(account_id),
                )
            ).one_or_none()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("completion_status_read_failed")
            raise HTTPException(
                status_code=503,
                detail={"code": "settlement_unavailable", "message": "completion status is unavailable"},
            ) from None
        if result is None:
            raise HTTPException(status_code=404, detail="completion not found")
        evidence, settlement = result
        if settlement is None:
            completed_at = datetime.fromisoformat(str(evidence.payload["completed_at"]).replace("Z", "+00:00"))
            reason = "settlement_not_queued"
            cutoff = config.economy_settlement_activated_at
            if not config.economy_settlement_enabled:
                reason = "settlement_disabled"
            elif cutoff is not None and completed_at < cutoff:
                reason = "historical_backfill_required"
            return CompletionSettlementResponse(
                event_id=evidence.event_id,
                run_id=evidence.run_id,
                life_index=evidence.life_index,
                status="pending",
                reason=reason,
                policy_version=None,
                credited={"FEATHER": "0", "GAME_STAR": "0"},
                completed_at=completed_at,
            )
        effective_reason = settlement.reason
        if settlement.status == "pending":
            cutoff = config.economy_settlement_activated_at
            if not config.economy_settlement_enabled:
                effective_reason = "settlement_disabled"
            elif cutoff is not None and settlement.completed_at < cutoff:
                effective_reason = "historical_backfill_required"
        return CompletionSettlementResponse(
            event_id=evidence.event_id,
            run_id=evidence.run_id,
            life_index=evidence.life_index,
            status=settlement.status,
            reason=effective_reason,
            policy_version=settlement.policy_version,
            credited={
                "FEATHER": str(settlement.feathers_credited),
                "GAME_STAR": str(settlement.stars_credited),
            },
            completed_at=settlement.completed_at,
        )

    @app.get("/api/v1/shop/catalog")
    def shop_catalog(claims: TokenClaims = Depends(current_claims)) -> dict[str, object]:
        del claims
        return public_catalog(enabled=config.economy_shop_enabled)

    @app.get("/api/v1/shop/inventory")
    def shop_inventory(
        limit: Annotated[int, Query(ge=1, le=100)] = 100,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            if cursor is not None:
                decode_inventory_cursor(cursor)
            with db.begin():
                ensure_starter_state(db, account_id)
                page = list_inventory(db, account_id=account_id, limit=limit, cursor=cursor)
            return {
                "items": [
                    {
                        "item_type": item.item_type,
                        "item_id": item.item_id,
                        "grant_kind": item.grant_kind,
                        "catalog_version": item.catalog_version,
                        "granted_at": item.granted_at,
                    }
                    for item in page.items
                ],
                "next_cursor": page.next_cursor,
            }
        except ValueError:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
            ) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=inventory")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.get("/api/v1/shop/equipment")
    def shop_equipment(
        claims: TokenClaims = Depends(current_claims), db: Session = Depends(get_economy_db)
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                rows = db.scalars(
                    select(CosmeticEquipment)
                    .where(CosmeticEquipment.account_id == account_id)
                    .order_by(CosmeticEquipment.item_type)
                ).all()
            return {
                "equipment": [
                    {"item_type": row.item_type, "item_id": row.item_id, "revision": row.revision} for row in rows
                ]
            }
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=equipment")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.put("/api/v1/shop/equipment/{item_type}")
    def update_shop_equipment(
        item_type: str,
        body: EquipmentUpdateRequest,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if not config.economy_shop_enabled:
            raise HTTPException(
                status_code=503, detail={"code": "shop_disabled", "message": "shop mutations are disabled"}
            )
        if item_type not in {"skin", "background"}:
            raise HTTPException(
                status_code=404, detail={"code": "item_type_not_found", "message": "item type not found"}
            )
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                offer = OFFERS_BY_ID.get(body.item_id)
                if offer is None:
                    raise ShopError("item_not_found", "item was not found", status_code=404)
                if offer.item_type != item_type:
                    raise ShopError("wrong_item_type", "item belongs to another category")
                owned = db.scalar(
                    select(CosmeticEntitlement.id).where(
                        CosmeticEntitlement.account_id == account_id,
                        CosmeticEntitlement.item_type == item_type,
                        CosmeticEntitlement.item_id == body.item_id,
                    )
                )
                if owned is None:
                    raise ShopError("item_not_owned", "item is not owned")
                current = db.scalar(
                    select(CosmeticEquipment)
                    .where(CosmeticEquipment.account_id == account_id, CosmeticEquipment.item_type == item_type)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if current is None:
                    raise RuntimeError("starter equipment row is missing")
                if body.expected_revision != current.revision:
                    raise ShopError(
                        "stale_equipment",
                        "equipment changed",
                        current={
                            "item_type": current.item_type,
                            "item_id": current.item_id,
                            "revision": current.revision,
                        },
                    )
                current.item_id = body.item_id
                current.revision += 1
                current.updated_at = func.now()
                db.flush()
                return {"item_type": current.item_type, "item_id": current.item_id, "revision": current.revision}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=equipment")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.post("/api/v1/shop/quotes", status_code=201)
    def create_shop_quote(
        body: ShopQuoteRequest,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if not config.economy_shop_enabled:
            raise HTTPException(
                status_code=503, detail={"code": "shop_disabled", "message": "shop mutations are disabled"}
            )
        try:
            with db.begin():
                ensure_starter_state(db, account_id)
                quote = make_quote(db, account_id=account_id, item_type=body.item_type, item_id=body.item_id)
            return serialize_quote(quote)
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=quote")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.post("/api/v1/shop/purchases")
    def create_shop_purchase(
        body: ShopPurchaseRequestBody,
        response: Response,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if idempotency_key is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key is required"},
            )
        try:
            with db.begin():
                result = commit_purchase(
                    db,
                    account_id=account_id,
                    quote_id=body.quote_id,
                    idempotency_key=idempotency_key,
                    enabled=config.economy_shop_enabled,
                )
            balance = db.scalar(
                select(Wallet.balance).where(
                    Wallet.account_id == account_id, Wallet.currency == result.purchase.currency
                )
            )
            response.status_code = 200 if result.replayed else 201
            return {"purchase": serialize_purchase(result.purchase), "current_balance": str(balance or 0)}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_write_failed endpoint=purchase")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.get("/api/v1/shop/purchases/lookup")
    def lookup_shop_purchase(
        idempotency_key: Annotated[str, Query(alias="idempotency_key", min_length=1, max_length=128)],
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        if idempotency_key != idempotency_key.strip():
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_idempotency_key", "message": "idempotency_key must be trimmed"},
            )
        try:
            row = db.execute(
                select(ShopPurchaseRequest, ShopPurchase)
                .join(
                    ShopPurchase,
                    (ShopPurchase.account_id == ShopPurchaseRequest.account_id)
                    & (ShopPurchase.id == ShopPurchaseRequest.purchase_id),
                )
                .where(
                    ShopPurchaseRequest.account_id == account_id,
                    ShopPurchaseRequest.idempotency_key == idempotency_key,
                )
            ).one_or_none()
            if row is None:
                raise ShopError("purchase_not_found", "purchase was not found", status_code=404)
            request, purchase = row
            balance = db.scalar(
                select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == purchase.currency)
            )
            return {
                "purchase": serialize_purchase(purchase),
                "idempotency_key": request.idempotency_key,
                "current_balance": str(balance or 0),
            }
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase_lookup")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.get("/api/v1/shop/purchases/{purchase_id}")
    def get_shop_purchase(
        purchase_id: uuid.UUID,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            purchase = db.scalar(
                select(ShopPurchase).where(ShopPurchase.id == purchase_id, ShopPurchase.account_id == account_id)
            )
            if purchase is None:
                raise ShopError("purchase_not_found", "purchase was not found", status_code=404)
            balance = db.scalar(
                select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == purchase.currency)
            )
            return {"purchase": serialize_purchase(purchase), "current_balance": str(balance or 0)}
        except ShopError as error:
            raise _shop_error(error) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.get("/api/v1/shop/purchases")
    def list_shop_purchases(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: str | None = None,
        claims: TokenClaims = Depends(current_claims),
        db: Session = Depends(get_economy_db),
    ) -> dict[str, object]:
        account_id = uuid.UUID(claims.subject)
        try:
            after = _decode_shop_cursor(cursor) if cursor is not None else None
            statement = select(ShopPurchase).where(ShopPurchase.account_id == account_id)
            if after is not None:
                statement = statement.where(
                    tuple_(ShopPurchase.created_at, ShopPurchase.id) < tuple_(literal(after[0]), literal(after[1]))
                )
            rows = db.scalars(
                statement.order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc()).limit(limit + 1)
            ).all()
            visible = rows[:limit]
            balances = {
                currency: db.scalar(
                    select(Wallet.balance).where(Wallet.account_id == account_id, Wallet.currency == currency)
                )
                or 0
                for currency in {purchase.currency for purchase in visible}
            }
            next_cursor = (
                _encode_shop_cursor(visible[-1].created_at, visible[-1].id) if len(rows) > limit and visible else None
            )
            return {
                "purchases": [
                    {
                        "purchase": serialize_purchase(purchase),
                        "current_balance": str(balances[purchase.currency]),
                    }
                    for purchase in visible
                ],
                "next_cursor": next_cursor,
            }
        except ValueError:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "cursor is invalid"}
            ) from None
        except SQLAlchemyError:
            db.rollback()
            logger.warning("shop_read_failed endpoint=purchase_history")
            raise HTTPException(
                status_code=503, detail={"code": "shop_unavailable", "message": "shop is unavailable"}
            ) from None

    @app.post("/internal/v1/run-completions", status_code=202)
    def accept_completion(
        event: RunLifeCompleted,
        authorization: Annotated[str | None, Header()] = None,
        db: Session = Depends(get_economy_db),
    ) -> dict[str, str | bool]:
        expected = f"Bearer {config.service_token}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="unauthorized")
        payload, digest = _payload_hash(event)
        identity_clause = or_(
            (CompletionEvidence.run_id == event.run_id) & (CompletionEvidence.life_index == event.life_index),
            CompletionEvidence.event_id == event.event_id,
        )
        previous = db.execute(select(CompletionEvidence).where(identity_clause).with_for_update()).scalars().all()
        if previous:
            if len(previous) != 1 or previous[0].payload_hash != digest:
                raise HTTPException(status_code=409, detail="completion evidence conflict")
            enqueue_settlement(db, previous[0], config)
            db.commit()
            return {"accepted": True, "event_id": str(previous[0].event_id), "duplicate": True}
        evidence = CompletionEvidence(
            event_id=event.event_id,
            run_id=event.run_id,
            life_index=event.life_index,
            payload=payload,
            payload_hash=digest,
        )
        db.add(evidence)
        try:
            db.flush()
            enqueue_settlement(db, evidence, config)
            db.commit()
        except IntegrityError:
            db.rollback()
            concurrent = db.execute(select(CompletionEvidence).where(identity_clause)).scalars().all()
            if len(concurrent) == 1 and concurrent[0].payload_hash == digest:
                enqueue_settlement(db, concurrent[0], config)
                db.commit()
                return {"accepted": True, "event_id": str(concurrent[0].event_id), "duplicate": True}
            raise HTTPException(status_code=409, detail="completion evidence conflict") from None
        return {"accepted": True, "event_id": str(event.event_id), "duplicate": False}

    return app


app = create_app()

from __future__ import annotations

import base64
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
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from sqlalchemy import or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import database
from app.auth import TelegramIdentity, TelegramInitDataError, verify_telegram_init_data
from app.economy.models import CompletionEvidence
from app.platform.models import Account, RefreshSession
from app.request_logging import configure_json_logger, install_request_logging
from app.schemas import AccessResponse, AccountResponse, DevAuthRequest, RunLifeCompleted, TelegramAuthRequest
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
            return {"accepted": True, "event_id": str(previous[0].event_id), "duplicate": True}
        db.add(
            CompletionEvidence(
                event_id=event.event_id,
                run_id=event.run_id,
                life_index=event.life_index,
                payload=payload,
                payload_hash=digest,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            concurrent = db.execute(select(CompletionEvidence).where(identity_clause)).scalars().all()
            if len(concurrent) == 1 and concurrent[0].payload_hash == digest:
                return {"accepted": True, "event_id": str(concurrent[0].event_id), "duplicate": True}
            raise HTTPException(status_code=409, detail="completion evidence conflict") from None
        return {"accepted": True, "event_id": str(event.event_id), "duplicate": False}

    return app


app = create_app()

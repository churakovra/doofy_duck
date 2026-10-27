from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth import TelegramIdentity, TelegramInitDataError, verify_telegram_init_data
from app.dependencies import get_platform_db
from app.platform.models import Account, RefreshSession
from app.schemas import (
    AccessResponse,
    DevAuthRequest,
    TelegramAuthRequest,
)
from app.settings import Settings
from app.tokens import ACCESS_TTL_SECONDS, Ed25519TokenIssuer

REFRESH_COOKIE = "dd_refresh"
CSRF_COOKIE = "dd_csrf"
REFRESH_TTL = timedelta(days=30)


def create_router(config: Settings, issuer: Ed25519TokenIssuer) -> APIRouter:
    router = APIRouter()

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
        try:
            return bool(csrf_cookie and csrf_header and hmac.compare_digest(csrf_cookie, csrf_header))
        except TypeError:
            return False

    @router.post("/api/v1/auth/telegram", response_model=AccessResponse)
    def telegram_login(
        body: TelegramAuthRequest, response: Response, db: Session = Depends(get_platform_db)
    ) -> AccessResponse:
        try:
            identity = verify_telegram_init_data(body.init_data, config.telegram_bot_token)
        except TelegramInitDataError:
            raise HTTPException(status_code=401, detail="unauthorized") from None
        account = account_for(identity, db)
        return issue_session(account, db, response)

    @router.post("/api/v1/auth/dev", response_model=AccessResponse)
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

    @router.post("/api/v1/auth/refresh", response_model=AccessResponse)
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
        candidate = db.execute(
            select(RefreshSession).where(RefreshSession.refresh_hash == refresh_hash)
        ).scalar_one_or_none()
        if candidate is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:family_id, 0))"),
            {"family_id": str(candidate.family_id)},
        )
        current = db.execute(
            select(RefreshSession)
            .where(RefreshSession.refresh_hash == refresh_hash)
            .with_for_update()
            .execution_options(populate_existing=True)
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

    @router.post("/api/v1/auth/logout", status_code=204)
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

    return router

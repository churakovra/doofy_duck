from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Header, HTTPException, Request
from sqlalchemy.orm import Session

from app import database
from app.tokens import AccessTokenError, TokenClaims, verify_access_token


def get_platform_db() -> Iterator[Session]:
    yield from database.platform_session()


def get_economy_db() -> Iterator[Session]:
    yield from database.economy_session()


def current_claims(request: Request, authorization: Annotated[str | None, Header()] = None) -> TokenClaims:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        return verify_access_token(authorization[7:], request.app.state.public_keys)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="unauthorized") from None

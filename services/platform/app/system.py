from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dependencies import get_economy_db, get_platform_db
from app.tokens import Ed25519TokenIssuer

logger = logging.getLogger("doofy.platform")


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def create_router(issuer: Ed25519TokenIssuer) -> APIRouter:
    router = APIRouter()

    @router.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/readyz")
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

    @router.get("/.well-known/jwks.json")
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

    return router

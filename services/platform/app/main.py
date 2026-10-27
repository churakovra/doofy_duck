from __future__ import annotations

import base64
import json
import logging
import os

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI

from app import account_routes, auth_routes, completion_routes, database, shop_routes, system
from app.request_logging import configure_json_logger, install_request_logging
from app.settings import Settings
from app.tokens import Ed25519TokenIssuer

logger = logging.getLogger("doofy.platform")
configure_json_logger(logger)


def _decode_raw_private(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise RuntimeError("ACCESS_TOKEN_PRIVATE_KEY_B64 must be base64url") from exc


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    config.validate_runtime()
    database.configure_databases(
        config.platform_database_url,
        config.economy_database_url,
        platform_pool_size=config.platform_pool_size,
        platform_max_overflow=config.platform_pool_max_overflow,
        platform_pool_timeout=config.platform_pool_timeout,
        economy_pool_size=config.economy_pool_size,
        economy_max_overflow=config.economy_pool_max_overflow,
        economy_pool_timeout=config.economy_pool_timeout,
    )
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

    app.include_router(system.create_router(issuer))
    app.include_router(auth_routes.create_router(config, issuer))
    app.include_router(account_routes.create_router(config))
    app.include_router(shop_routes.create_router(config))
    app.include_router(completion_routes.create_router(config))
    return app


app = create_app()

#!/usr/bin/env python3
"""Create ignored local-only backend credentials for Compose development."""

import base64
import json
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

root = Path(__file__).resolve().parents[2]
out = root / ".env.dev"
if out.exists():
    raise SystemExit(f"{out} already exists; remove it explicitly to rotate development credentials")


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


private = Ed25519PrivateKey.generate()
private_bytes = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                      serialization.NoEncryption())
public_bytes = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
kid = "dd-local-" + secrets.token_hex(4)
values = {
    "POSTGRES_ADMIN_PASSWORD": secrets.token_urlsafe(32),
    "PLATFORM_DB_PASSWORD": secrets.token_urlsafe(32),
    "ECONOMY_DB_PASSWORD": secrets.token_urlsafe(32),
    "CORE_DB_PASSWORD": secrets.token_urlsafe(32),
    "TELEGRAM_BOT_TOKEN": "development-only-not-a-real-bot-token",
    "ACCESS_TOKEN_PRIVATE_KEY_B64": b64(private_bytes),
    "ACCESS_TOKEN_KEY_ID": kid,
    "ACCESS_TOKEN_PUBLIC_KEYS_JSON": json.dumps({kid: b64(public_bytes)}, separators=(",", ":")),
    "CORE_TO_PLATFORM_TOKEN": secrets.token_urlsafe(48),
    "CORE_OPERATOR_TOKEN": secrets.token_urlsafe(48),
}
# Quote dotenv values so the same file is safe to source in a shell. All values
# generated above are single-quote free (url-safe tokens or JSON), and Compose
# removes the dotenv quotes while expanding them into container environments.
out.write_text("".join(f"{key}='{value}'\n" for key, value in values.items()), encoding="utf-8")
out.chmod(0o600)
print(f"Created local-only credentials in {out}; keep this ignored file private.")

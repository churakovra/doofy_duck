from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ISSUER = "doofy-platform"
AUDIENCE = "doofy-core"
ACCESS_TTL_SECONDS = 600


class AccessTokenError(ValueError):
    pass


@dataclass(frozen=True)
class TokenClaims:
    subject: str
    issued_at: int
    expires_at: int
    token_id: str
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class Ed25519TokenIssuer:
    key_id: str
    private_key: Ed25519PrivateKey

    @classmethod
    def generate(cls, kid: str = "local") -> Ed25519TokenIssuer:
        return cls(kid, Ed25519PrivateKey.generate())

    @classmethod
    def from_raw_private_key(cls, key_id: str, raw: bytes) -> Ed25519TokenIssuer:
        if len(raw) != 32:
            raise ValueError("Ed25519 private key must be 32 raw bytes")
        return cls(key_id, Ed25519PrivateKey.from_private_bytes(raw))

    @property
    def public_key(self) -> Ed25519PublicKey:
        return self.private_key.public_key()

    def public_key_bytes(self) -> bytes:
        return self.public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    def issue(self, subject: str, *, now: datetime | None = None) -> str:
        try:
            subject = str(uuid.UUID(subject))
        except ValueError as exc:
            raise ValueError("subject must be an account UUID") from exc
        issued_at = int((now or datetime.now(UTC)).timestamp())
        header = {"alg": "EdDSA", "typ": "JWT", "kid": self.key_id}
        claims = {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": subject,
            "iat": issued_at,
            "exp": issued_at + ACCESS_TTL_SECONDS,
            "jti": str(uuid.uuid4()),
            "scope": ["run:write"],
        }
        encoded_header = _b64(json.dumps(header, separators=(",", ":")).encode())
        encoded_claims = _b64(json.dumps(claims, separators=(",", ":")).encode())
        signing_input = f"{encoded_header}.{encoded_claims}"
        signature = self.private_key.sign(signing_input.encode())
        return f"{signing_input}.{_b64(signature)}"


def verify_access_token(
    token: str,
    public_keys: dict[str, Ed25519PublicKey],
    *,
    now: datetime | None = None,
    required_scope: str = "run:write",
) -> TokenClaims:
    try:
        encoded_header, encoded_claims, encoded_signature = token.split(".")
        header = json.loads(_unb64(encoded_header))
        claims: dict[str, Any] = json.loads(_unb64(encoded_claims))
        key_id = header["kid"]
        if header != {"alg": "EdDSA", "typ": "JWT", "kid": key_id}:
            raise AccessTokenError("unsupported token header")
        key = public_keys[key_id]
        key.verify(_unb64(encoded_signature), f"{encoded_header}.{encoded_claims}".encode())
        issued_at = int(claims["iat"])
        expires_at = int(claims["exp"])
        subject = str(uuid.UUID(claims["sub"]))
        token_id = str(uuid.UUID(claims["jti"]))
        scopes = claims["scope"]
        current = int((now or datetime.now(UTC)).timestamp())
        if claims["iss"] != ISSUER or claims["aud"] != AUDIENCE:
            raise AccessTokenError("issuer or audience mismatch")
        if (
            issued_at > current + 30
            or expires_at <= current
            or expires_at <= issued_at
            or expires_at - issued_at > ACCESS_TTL_SECONDS
        ):
            raise AccessTokenError("token expired or has invalid lifetime")
        if not isinstance(scopes, list) or required_scope not in scopes:
            raise AccessTokenError("required scope missing")
        return TokenClaims(subject, issued_at, expires_at, token_id, tuple(scopes))
    except AccessTokenError:
        raise
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, InvalidSignature) as exc:
        raise AccessTokenError("invalid access token") from exc


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    if not value or not all(char.isalnum() or char in "-_" for char in value):
        raise ValueError("invalid base64url")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

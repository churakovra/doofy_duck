from __future__ import annotations

import json
import logging
import re
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, TextIO

from fastapi import FastAPI, Request, Response

_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields: dict[str, Any] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        fields.update(getattr(record, "safe_fields", {}))
        return json.dumps(fields, separators=(",", ":"), sort_keys=True)


def configure_json_logger(logger: logging.Logger, *, stream: TextIO | None = None) -> None:
    """Ensure application outcome logs reach stdout as structured JSON."""
    if not any(getattr(handler, "_doofy_json_handler", False) for handler in logger.handlers):
        handler = logging.StreamHandler(stream or sys.stdout)
        handler.setFormatter(_JSONFormatter())
        handler._doofy_json_handler = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def _correlation_id(candidate: str | None) -> str:
    if candidate and _UUID_PATTERN.fullmatch(candidate):
        return candidate
    return str(uuid.uuid4())


def install_request_logging(app: FastAPI, logger: logging.Logger) -> None:
    @app.middleware("http")
    async def safe_request_log(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = _correlation_id(request.headers.get("X-Request-ID"))
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            route = request.scope.get("route")
            route_name = getattr(route, "path", "unmatched") or "unmatched"
            method = request.method if request.method in _METHODS else "OTHER"
            logger.info(
                "http_request",
                extra={
                    "safe_fields": {
                        "request_id": request_id,
                        "method": method,
                        "route": route_name,
                        "status": status,
                        "duration_ms": int((time.perf_counter() - started) * 1000),
                    }
                },
            )

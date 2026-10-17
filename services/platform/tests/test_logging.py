import io
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.request_logging import configure_json_logger, install_request_logging


def test_request_logs_are_json_safe_and_correlated_for_error_responses():
    output = io.StringIO()
    logger = logging.getLogger("test.platform.request")
    configure_json_logger(logger, stream=output)
    app = FastAPI()
    install_request_logging(app, logger)

    @app.get("/runs/{run_id}")
    def fail(run_id: str):
        raise HTTPException(status_code=429, detail="retry")

    with TestClient(app) as client:
        response = client.get(
            "/runs/private-run-id?access_token=private-query",
            headers={"X-Request-ID": "untrusted correlation value"},
        )

    assert response.status_code == 429
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 36
    event = json.loads(output.getvalue())
    assert event["event"] == "http_request"
    assert event["request_id"] == request_id
    assert event["method"] == "GET"
    assert event["route"] == "/runs/{run_id}"
    assert event["status"] == 429
    assert isinstance(event["duration_ms"], int)
    for secret in ("private-run-id", "private-query", "untrusted correlation value", "access_token"):
        assert secret not in output.getvalue()


def test_valid_uuid_correlation_is_preserved_and_unmatched_path_is_not_logged():
    output = io.StringIO()
    logger = logging.getLogger("test.platform.request.valid")
    configure_json_logger(logger, stream=output)
    app = FastAPI()
    install_request_logging(app, logger)

    with TestClient(app) as client:
        response = client.get(
            "/missing/private-run?token=secret",
            headers={"X-Request-ID": "00000000-0000-4000-8000-000000000001"},
        )

    assert response.status_code == 404
    assert response.headers["x-request-id"] == "00000000-0000-4000-8000-000000000001"
    event = json.loads(output.getvalue())
    assert event["route"] == "unmatched"
    assert event["status"] == 404
    assert "private-run" not in output.getvalue()
    assert "secret" not in output.getvalue()

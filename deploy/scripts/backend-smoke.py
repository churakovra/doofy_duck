#!/usr/bin/env python3
"""Exercise local browser-to-Core-to-Platform completion delivery."""

from __future__ import annotations

import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from jsonschema import validate

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/platform"))
from app.schemas import RunLifeCompleted  # noqa: E402

ORIGIN = "http://127.0.0.1:8080"


def request(path: str, *, token: str | None = None, body: object | None = None) -> tuple[int, object]:
    headers = {"Accept": "application/json"}
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body, separators=(",", ":")).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(ORIGIN + path, data=payload, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    return response.status, json.loads(raw) if raw else {}


def main() -> None:
    status, login = request("/api/v1/auth/dev", body={"telegram_user_id": secrets.randbelow(2**52) + 1})
    assert status == 200, f"development login failed: HTTP {status}"
    token = login["access_token"]

    status, account = request("/api/v1/account", token=token)
    assert status == 200 and account.get("account_id"), "own-account lookup failed"

    status, run = request("/api/v1/runs", token=token, body={})
    assert status == 201, f"run creation failed: HTTP {status}"

    other_status, other_login = request("/api/v1/auth/dev", body={"telegram_user_id": secrets.randbelow(2**52) + 1})
    assert other_status == 200, "second development login failed"
    cross_status, _ = request(f"/api/v1/runs/{run['runId']}", token=other_login["access_token"])
    assert cross_status == 404, f"cross-account run access returned HTTP {cross_status}"

    completed = False
    for sequence in range(120):
        ticks = [[{"sequence": 0, "action": "FLAP"}]] if sequence == 0 else [[]]
        status, ack = request(
            f"/api/v1/runs/{run['runId']}/checkpoints",
            token=token,
            body={
                "checkpointSequence": sequence,
                "writerGeneration": run["writerGeneration"],
                "writerToken": run["writerToken"],
                "idempotencyKey": f"smoke-checkpoint-{sequence:03d}",
                "ticks": ticks,
            },
        )
        assert status == 200, f"checkpoint {sequence} failed: HTTP {status}"
        if ack.get("status") == "completion_pending":
            assert ack.get("verificationStatus") == "verified", "completion was not verified"
            completed = True
            break
    assert completed, "deterministic flight did not complete within 120 ticks"

    query = (
        "SELECT count(*) || ':' || min(payload::text) FROM completion_inbox "
        "WHERE run_id = '" + run["runId"] + "'::uuid AND life_index = 0"
    )
    deadline = time.monotonic() + 30
    evidence = ""
    while time.monotonic() < deadline:
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                ".env.dev",
                "-f",
                "deploy/compose.yaml",
                "--profile",
                "local",
                "exec",
                "-T",
                "postgres",
                "sh",
                "-ec",
                'PGPASSWORD=$ECONOMY_DB_PASSWORD psql -h 127.0.0.1 -U economy -d economy -At -c "' + query + '"',
            ],
            check=True,
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        evidence = result.stdout.strip()
        if evidence.startswith("1:"):
            break
        time.sleep(0.25)
    assert evidence.startswith("1:"), f"expected one stored completion, got {evidence!r}"
    event = json.loads(evidence[2:])
    schema = json.loads((ROOT / "contracts/events/run-life-completed-v1.schema.json").read_text())
    RunLifeCompleted.model_validate(event)
    validate(event, schema)
    print("Backend smoke passed: account ownership, Core run verification, and one stored completion.")


if __name__ == "__main__":
    main()

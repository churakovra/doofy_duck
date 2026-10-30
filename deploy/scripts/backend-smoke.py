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
SMOKE_TIMEOUT_SECONDS = 180
smoke_deadline = 0.0
SIMULATION_TRACE = r"""
import { createRun, createRunDescriptor, makeInput, step } from './packages/game-sim/dist/index.js';
let state = createRun(createRunDescriptor({ runId: input.runId, seed: input.seed }));
let sequence = 0;
let feathers = 0;
const ticks = [];
while (state.phase !== 'DEAD' && state.tick < 1800) {
  const stopAfterPickup = feathers > 0 && state.tick >= 300;
  const shouldFlap = !stopAfterPickup && state.tick < 1200
    && (state.tick === 0 || (state.duck.y > 300000 && state.duck.vy >= 0));
  const frames = shouldFlap ? [makeInput(sequence++, 'FLAP')] : [];
  const result = step(state, frames);
  state = result.state;
  for (const event of result.events) {
    if (event.type === 'CurrencyCollected' && event.typeId === 'FEATHER') feathers += event.amount;
  }
  ticks.push(frames.map(frame => ({ sequence: frame.sequence, action: frame.action })));
}
if (state.phase !== 'DEAD') throw new Error('simulation trace did not terminate');
console.log(JSON.stringify({ ticks, feathers, totals: state.totals }));
"""


def request(
    path: str, *, token: str | None = None, body: object | None = None
) -> tuple[int, object]:
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


def simulate_run(run: dict[str, object]) -> dict[str, object]:
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "const input=JSON.parse(await new Promise(r=>{let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>r(s))}));\n"
            + SIMULATION_TRACE,
        ],
        input=json.dumps({"runId": run["runId"], "seed": run["seed"]}),
        check=False,
        timeout=10,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "local simulation trace failed without backend credentials: "
            f"{result.stderr.strip()}"
        )
    return json.loads(result.stdout)


def submit_simulated_run(
    run: dict[str, object], token: str, ticks: list[list[dict[str, object]]]
) -> dict[str, object]:
    verified: dict[str, object] | None = None
    for sequence, start in enumerate(range(0, len(ticks), 120)):
        batch = ticks[start : start + 120]
        status, ack = request(
            f"/api/v1/runs/{run['runId']}/checkpoints",
            token=token,
            body={
                "checkpointSequence": sequence,
                "writerGeneration": run["writerGeneration"],
                "writerToken": run["writerToken"],
                "idempotencyKey": f"smoke-{run['runId']}-{sequence:03d}",
                "ticks": batch,
            },
        )
        assert status == 200, f"checkpoint {sequence} failed: HTTP {status}"
        if ack.get("verificationStatus") == "verified":
            verified = ack
            break
    assert verified is not None, (
        "simulated flight did not complete within submitted checkpoints"
    )
    assert verified.get("status") == "completed", (
        "verified gameplay did not reach a terminal lifecycle state"
    )
    return verified


def wait_for_delivery(run_id: str, token: str) -> None:
    deadline = min(time.monotonic() + 30, smoke_deadline)
    while time.monotonic() < deadline:
        status, snapshot = request(f"/api/v1/runs/{run_id}", token=token)
        assert status == 200, f"verified run lookup failed: HTTP {status}"
        assert (
            snapshot.get("status") == "completed"
            and snapshot.get("verificationStatus") == "verified"
        ), f"delivery changed verified gameplay lifecycle: {snapshot!r}"
        if snapshot.get("deliveryStatus") == "delivered":
            return
        assert snapshot.get("deliveryStatus") != "rejected", (
            "Platform permanently rejected completion delivery"
        )
        time.sleep(0.25)
    raise AssertionError("completion delivery did not finish")


def wait_for_settlement(run_id: str, token: str) -> dict[str, object]:
    deadline = min(time.monotonic() + 30, smoke_deadline)
    while time.monotonic() < deadline:
        status, settlement = request(f"/api/v1/completions/{run_id}/0", token=token)
        assert status == 200, f"completion settlement lookup failed: HTTP {status}"
        if settlement.get("status") == "committed":
            return settlement
        assert settlement.get("status") != "actionable_failure", (
            f"settlement failed: {settlement!r}"
        )
        time.sleep(0.25)
    raise AssertionError("local settlement worker did not commit the completion")


def main() -> None:
    global smoke_deadline
    smoke_deadline = time.monotonic() + SMOKE_TIMEOUT_SECONDS
    subprocess.run(["npm", "run", "build:sim"], check=True, cwd=ROOT)
    status, login = request(
        "/api/v1/auth/dev", body={"telegram_user_id": secrets.randbelow(2**52) + 1}
    )
    assert status == 200, f"development login failed: HTTP {status}"
    token = login["access_token"]

    status, account = request("/api/v1/account", token=token)
    assert status == 200 and account.get("account_id"), "own-account lookup failed"

    status, run = request("/api/v1/runs", token=token, body={})
    assert status == 201, f"run creation failed: HTTP {status}"

    other_status, other_login = request(
        "/api/v1/auth/dev", body={"telegram_user_id": secrets.randbelow(2**52) + 1}
    )
    assert other_status == 200, "second development login failed"
    cross_status, _ = request(
        f"/api/v1/runs/{run['runId']}", token=other_login["access_token"]
    )
    assert cross_status == 404, f"cross-account run access returned HTTP {cross_status}"

    # Replay a real local simulation trace. Try a small bounded set of server seeds
    # until its safe flight path crosses a generated FEATHER pickup.
    positive_run: dict[str, object] | None = None
    observed_feathers = 0
    for attempt in range(8):
        assert time.monotonic() < smoke_deadline, (
            "backend smoke exceeded its 180-second budget"
        )
        current_run = run if attempt == 0 else None
        if current_run is None:
            status, current_run = request("/api/v1/runs", token=token, body={})
            assert status == 201, f"run creation failed: HTTP {status}"
        trace = simulate_run(current_run)
        verified = submit_simulated_run(current_run, token, trace["ticks"])
        assert verified["state"]["totals"].get("FEATHER", 0) == trace["feathers"], (
            "Core replay disagreed with the local trace"
        )
        wait_for_delivery(current_run["runId"], token)
        if trace["feathers"] > 0:
            positive_run = current_run
            observed_feathers = trace["feathers"]
            break
    assert positive_run is not None, (
        "none of eight safe simulated flights collected a FEATHER"
    )

    settlement = wait_for_settlement(positive_run["runId"], token)
    assert int(settlement["credited"]["FEATHER"]) == observed_feathers, (
        f"unexpected FEATHER settlement: {settlement!r}"
    )
    assert int(settlement["credited"]["FEATHER"]) > 0, (
        "positive simulated pickup was not credited"
    )

    status, catalog = request("/api/v1/shop/catalog", token=token)
    assert status == 200 and catalog.get("enabled") is True, (
        f"local shop mutations are disabled: {catalog!r}"
    )
    status, inventory = request("/api/v1/shop/inventory?limit=100", token=token)
    assert status == 200 and {("skin", "classic"), ("background", "meadow")} <= {
        (item["item_type"], item["item_id"]) for item in inventory["items"]
    }, f"starter account inventory is missing: {inventory!r}"
    status, equipment = request("/api/v1/shop/equipment", token=token)
    assert status == 200 and {
        (row["item_type"], row["item_id"]) for row in equipment["equipment"]
    } >= {("skin", "classic"), ("background", "meadow")}, (
        f"starter account equipment is missing: {equipment!r}"
    )

    status, wallet = request("/api/v1/wallets", token=token)
    assert status == 200, f"account wallet read failed: HTTP {status}"
    balances = {item["currency"]: item["balance"] for item in wallet["balances"]}
    assert int(balances.get("FEATHER", "0")) >= observed_feathers, (
        f"wallet missed settled earnings: {wallet!r}"
    )

    # A fresh development login for the same Telegram identity reads the same
    # account-owned wallet and equipment state; no browser balance is supplied.
    status, relogin = request(
        "/api/v1/auth/dev", body={"telegram_user_id": account["telegram_user_id"]}
    )
    assert status == 200, f"development re-login failed: HTTP {status}"
    status, restored_wallet = request("/api/v1/wallets", token=relogin["access_token"])
    assert status == 200 and restored_wallet == wallet, (
        "wallet state did not survive account re-login"
    )
    status, restored_equipment = request(
        "/api/v1/shop/equipment", token=relogin["access_token"]
    )
    assert status == 200 and restored_equipment == equipment, (
        "equipment state did not survive account re-login"
    )

    query = (
        "SELECT count(*) || ':' || min(payload::text) FROM completion_inbox "
        "WHERE run_id = '" + positive_run["runId"] + "'::uuid AND life_index = 0"
    )
    deadline = min(time.monotonic() + 30, smoke_deadline)
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
                'PGPASSWORD=$ECONOMY_DB_PASSWORD psql -h 127.0.0.1 -U economy -d economy -At -c "'
                + query
                + '"',
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
    assert evidence.startswith("1:"), (
        f"expected one stored completion, got {evidence!r}"
    )
    event = json.loads(evidence[2:])
    schema = json.loads(
        (ROOT / "contracts/events/run-life-completed-v1.schema.json").read_text()
    )
    RunLifeCompleted.model_validate(event)
    validate(event, schema)
    print(
        "Backend smoke passed: account ownership, Core replay, one verified pickup, "
        "positive settlement, shop/equipment reads, re-login persistence, and one stored completion."
    )


if __name__ == "__main__":
    main()

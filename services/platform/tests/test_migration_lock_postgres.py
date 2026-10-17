from __future__ import annotations

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

pytestmark = pytest.mark.skipif(
    not (os.getenv("PLATFORM_TEST_DATABASE_URL") and os.getenv("ECONOMY_TEST_DATABASE_URL")),
    reason="PostgreSQL integration URLs are not configured",
)


@pytest.mark.parametrize(
    ("url_name", "env_name", "config", "table", "revision"),
    [
        (
            "PLATFORM_TEST_DATABASE_URL",
            "PLATFORM_DATABASE_URL",
            "alembic-platform.ini",
            "accounts",
            "0001_accounts_sessions",
        ),
        (
            "ECONOMY_TEST_DATABASE_URL",
            "ECONOMY_DATABASE_URL",
            "alembic-economy.ini",
            "completion_inbox",
            "0004_cosmetic_shop",
        ),
    ],
)
def test_concurrent_alembic_startup_is_serialized(url_name: str, env_name: str, config: str, table: str, revision: str):
    url = os.environ[url_name]
    if not make_url(url).database.endswith("_test"):
        raise RuntimeError("PostgreSQL migration tests only accept dedicated *_test databases")
    schema = f"migration_lock_{uuid4().hex}"
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    scoped_url = make_url(url).set(query={**make_url(url).query, "options": f"-csearch_path={schema}"})
    env = os.environ.copy()
    # Alembic stores this URL through ConfigParser, where percent escapes must
    # be doubled so the driver receives the original ``%3D`` query escape.
    env[env_name] = scoped_url.render_as_string(hide_password=False).replace("%", "%%")
    command = [sys.executable, "-m", "alembic", "-c", config, "upgrade", "head"]
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: subprocess.run(command, env=env, capture_output=True), range(2)))
        failures = [result.stderr.decode(errors="replace") for result in results if result.returncode != 0]
        safe_failures = "\n".join(failures).replace(make_url(url).password or "", "[redacted]")
        assert not failures, f"concurrent migrations returned a failure: {safe_failures[-1000:]}"
        with engine.connect() as connection:
            version = connection.execute(text(f'SELECT version_num FROM "{schema}".alembic_version')).scalar_one()
            assert version == revision
            assert connection.execute(
                text("SELECT to_regclass(:table_name)"), {"table_name": f"{schema}.{table}"}
            ).scalar_one()
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()

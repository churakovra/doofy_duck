from __future__ import annotations

import re
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class PlatformBase(DeclarativeBase):
    pass


class EconomyBase(DeclarativeBase):
    pass


platform_engine = None
economy_engine = None
PlatformSession = None
EconomySession = None


def configure_databases(
    platform_url: str,
    economy_url: str,
    *,
    platform_pool_size: int = 5,
    platform_max_overflow: int = 10,
    platform_pool_timeout: float = 30.0,
    economy_pool_size: int = 5,
    economy_max_overflow: int = 10,
    economy_pool_timeout: float = 30.0,
) -> None:
    global platform_engine, economy_engine, PlatformSession, EconomySession
    platform_engine = create_bounded_engine(
        platform_url,
        pool_size=platform_pool_size,
        max_overflow=platform_max_overflow,
        pool_timeout=platform_pool_timeout,
    )
    economy_engine = create_bounded_engine(
        economy_url, pool_size=economy_pool_size, max_overflow=economy_max_overflow, pool_timeout=economy_pool_timeout
    )
    PlatformSession = sessionmaker(platform_engine, expire_on_commit=False)
    EconomySession = sessionmaker(economy_engine, expire_on_commit=False)


def create_bounded_engine(
    url: str, *, pool_size: int = 5, max_overflow: int = 10, pool_timeout: float = 30.0
) -> Engine:
    """Create an engine with bounded PostgreSQL connection and statement waits."""
    pool_options = {
        "pool_pre_ping": True,
        "pool_size": pool_size,
        "max_overflow": max_overflow,
        "pool_timeout": pool_timeout,
    }
    parsed = make_url(url)
    if not parsed.drivername.startswith("postgresql"):
        return create_engine(parsed, pool_pre_ping=True)
    query = dict(parsed.query)
    existing_options = query.get("options", "")
    options = " ".join(existing_options) if isinstance(existing_options, tuple) else existing_options
    defaults = {"statement_timeout": "30000", "lock_timeout": "5000"}
    for setting, value in defaults.items():
        if not re.search(rf"(?:^|\s)(?:-c\s*|--)?{setting}=", options):
            options = f"{options} -c {setting}={value}".strip()
    query["options"] = options
    query.setdefault("connect_timeout", "5")
    parsed = parsed.set(query=query)
    return create_engine(parsed, **pool_options)


def platform_session() -> Generator[Session]:
    if PlatformSession is None:
        raise RuntimeError("platform database is not configured")
    with PlatformSession() as session:
        yield session


def economy_session() -> Generator[Session]:
    if EconomySession is None:
        raise RuntimeError("economy database is not configured")
    with EconomySession() as session:
        yield session

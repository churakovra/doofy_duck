from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class PlatformBase(DeclarativeBase):
    pass


class EconomyBase(DeclarativeBase):
    pass


platform_engine = None
economy_engine = None
PlatformSession = None
EconomySession = None


def configure_databases(platform_url: str, economy_url: str) -> None:
    global platform_engine, economy_engine, PlatformSession, EconomySession
    platform_engine = create_engine(platform_url, pool_pre_ping=True)
    economy_engine = create_engine(economy_url, pool_pre_ping=True)
    PlatformSession = sessionmaker(platform_engine, expire_on_commit=False)
    EconomySession = sessionmaker(economy_engine, expire_on_commit=False)


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

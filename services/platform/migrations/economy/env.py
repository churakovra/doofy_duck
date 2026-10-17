from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.database import EconomyBase
from app.economy import models  # noqa: F401
from app.settings import Settings

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", Settings.from_env().economy_database_url)
target_metadata = EconomyBase.metadata


def run_migrations_offline():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        lock_key = 0x444F4F465945434F
        connection.execute(text("SELECT pg_advisory_lock(:lock_key)"), {"lock_key": lock_key})
        connection.commit()
        try:
            context.configure(connection=connection, target_metadata=target_metadata)
            with context.begin_transaction():
                context.run_migrations()
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:lock_key)"), {"lock_key": lock_key})
            connection.commit()


run_migrations_offline() if context.is_offline_mode() else run_migrations_online()

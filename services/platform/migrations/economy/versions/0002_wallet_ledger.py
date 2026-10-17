"""Add authoritative wallet projections and immutable ledger entries."""

import sqlalchemy as sa
from alembic import op

revision = "0002_wallet_ledger"
down_revision = "0001_completion_inbox"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "wallets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("balance", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_wallet_currency"),
        sa.CheckConstraint("balance >= 0", name="ck_wallet_balance_nonnegative"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "currency", name="uq_wallet_account_currency"),
    )
    op.create_table(
        "wallet_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("wallet_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("operation_id", sa.String(length=160), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("delta", sa.BigInteger(), nullable=False),
        sa.Column("source_kind", sa.String(length=64), nullable=False),
        sa.Column("source_reference", sa.String(length=200), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("correlation_reference", sa.String(length=200), nullable=True),
        sa.Column("adjusts_entry_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_wallet_ledger_currency"),
        sa.CheckConstraint("delta <> 0", name="ck_wallet_ledger_delta_nonzero"),
        sa.ForeignKeyConstraint(["wallet_id"], ["wallets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["adjusts_entry_id"], ["wallet_ledger_entries.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "currency", "operation_id", name="uq_wallet_ledger_operation"),
    )
    op.create_index(
        "ix_wallet_ledger_account_currency_order",
        "wallet_ledger_entries",
        ["account_id", "currency", "created_at", "id"],
    )
    op.create_index("ix_wallet_ledger_wallet_id", "wallet_ledger_entries", ["wallet_id"])
    op.execute(
        """
        CREATE FUNCTION prevent_wallet_ledger_entry_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'wallet ledger entries are immutable'
                USING ERRCODE = 'integrity_constraint_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER wallet_ledger_entries_immutable
        BEFORE UPDATE OR DELETE ON wallet_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION prevent_wallet_ledger_entry_mutation()
        """
    )


def downgrade():
    # Financial history is destructive to remove. This downgrade is for disposable
    # development databases only; production rollback must preserve ledger data.
    op.execute("DROP TRIGGER wallet_ledger_entries_immutable ON wallet_ledger_entries")
    op.execute("DROP FUNCTION prevent_wallet_ledger_entry_mutation()")
    op.drop_index("ix_wallet_ledger_wallet_id", table_name="wallet_ledger_entries")
    op.drop_index("ix_wallet_ledger_account_currency_order", table_name="wallet_ledger_entries")
    op.drop_table("wallet_ledger_entries")
    op.drop_table("wallets")

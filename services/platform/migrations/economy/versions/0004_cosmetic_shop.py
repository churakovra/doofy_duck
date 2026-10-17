"""Add account-owned cosmetics, quotes, and atomic purchase records."""

import sqlalchemy as sa
from alembic import op

revision = "0004_cosmetic_shop"
down_revision = "0003_completion_settlement"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cosmetic_entitlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("grant_kind", sa.String(length=32), nullable=False),
        sa.Column("grant_reference", sa.String(length=200), nullable=False),
        sa.Column("catalog_version", sa.String(length=32), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("item_type IN ('skin', 'background')", name="ck_cosmetic_entitlement_type"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "item_type", "item_id", name="uq_cosmetic_entitlement_equipment_fk"),
    )
    op.create_index(
        "ix_cosmetic_entitlements_account_order",
        "cosmetic_entitlements",
        ["account_id", "item_type", "item_id"],
    )
    op.create_table(
        "cosmetic_equipment",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("item_type IN ('skin', 'background')", name="ck_cosmetic_equipment_type"),
        sa.CheckConstraint("revision >= 1", name="ck_cosmetic_equipment_revision"),
        sa.ForeignKeyConstraint(
            ["account_id", "item_type", "item_id"],
            ["cosmetic_entitlements.account_id", "cosmetic_entitlements.item_type", "cosmetic_entitlements.item_id"],
            name="fk_cosmetic_equipment_owned_item",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("account_id", "item_type"),
    )
    op.create_table(
        "shop_quotes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("catalog_version", sa.String(length=32), nullable=False),
        sa.Column("eligibility_version", sa.String(length=48), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("item_type IN ('skin', 'background')", name="ck_shop_quote_item_type"),
        sa.CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_shop_quote_currency"),
        sa.CheckConstraint("amount > 0", name="ck_shop_quote_amount_positive"),
        sa.CheckConstraint("expires_at > created_at", name="ck_shop_quote_expiry"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "id", name="uq_shop_quote_account_id"),
    )
    op.create_index("ix_shop_quotes_account_created", "shop_quotes", ["account_id", "created_at", "id"])
    op.create_table(
        "shop_purchases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("quote_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("catalog_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="committed", nullable=False),
        sa.Column("ledger_entry_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("item_type IN ('skin', 'background')", name="ck_shop_purchase_item_type"),
        sa.CheckConstraint("currency IN ('FEATHER', 'GAME_STAR')", name="ck_shop_purchase_currency"),
        sa.CheckConstraint("amount > 0", name="ck_shop_purchase_amount_positive"),
        sa.CheckConstraint("status = 'committed'", name="ck_shop_purchase_committed"),
        sa.ForeignKeyConstraint(
            ["account_id", "quote_id"],
            ["shop_quotes.account_id", "shop_quotes.id"],
            name="fk_shop_purchase_account_quote",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "item_type", "item_id"],
            ["cosmetic_entitlements.account_id", "cosmetic_entitlements.item_type", "cosmetic_entitlements.item_id"],
            name="fk_shop_purchase_entitlement",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ledger_entry_id"], ["wallet_ledger_entries.id"], name="fk_shop_purchase_ledger_entry", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "id", name="uq_shop_purchase_account_id"),
        sa.UniqueConstraint("account_id", "quote_id", name="uq_shop_purchase_quote"),
    )
    op.create_index("ix_shop_purchases_account_created", "shop_purchases", ["account_id", "created_at", "id"])
    op.create_table(
        "shop_purchase_requests",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("purchase_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_shop_request_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_shop_request_fingerprint_length"),
        sa.ForeignKeyConstraint(
            ["account_id", "purchase_id"],
            ["shop_purchases.account_id", "shop_purchases.id"],
            name="fk_shop_request_purchase_result",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.PrimaryKeyConstraint("account_id", "idempotency_key"),
    )
    op.execute(
        """
        CREATE FUNCTION prevent_shop_record_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'shop records are immutable'
                USING ERRCODE = 'integrity_constraint_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for table in ("cosmetic_entitlements", "shop_quotes", "shop_purchases", "shop_purchase_requests"):
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION prevent_shop_record_mutation()"
        )


def downgrade():
    # Removing entitlements and purchase records is destructive; development only.
    for table in ("shop_purchase_requests", "shop_purchases", "shop_quotes", "cosmetic_entitlements"):
        op.execute(f"DROP TRIGGER {table}_immutable ON {table}")
    op.execute("DROP FUNCTION prevent_shop_record_mutation()")
    op.drop_table("shop_purchase_requests")
    op.drop_index("ix_shop_purchases_account_created", table_name="shop_purchases")
    op.drop_table("shop_purchases")
    op.drop_index("ix_shop_quotes_account_created", table_name="shop_quotes")
    op.drop_table("shop_quotes")
    op.drop_table("cosmetic_equipment")
    op.drop_index("ix_cosmetic_entitlements_account_order", table_name="cosmetic_entitlements")
    op.drop_table("cosmetic_entitlements")

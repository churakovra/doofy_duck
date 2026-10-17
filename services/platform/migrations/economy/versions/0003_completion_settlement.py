"""Add durable settlement state for accepted verified completion facts."""

import sqlalchemy as sa
from alembic import op

revision = "0003_completion_settlement"
down_revision = "0002_wallet_ledger"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "completion_settlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("life_index", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=True),
        sa.Column("policy_version", sa.String(length=64), nullable=True),
        sa.Column("feathers_credited", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("stars_credited", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'committed', 'ineligible', 'actionable_failure')",
            name="ck_completion_settlement_status",
        ),
        sa.CheckConstraint("feathers_credited >= 0", name="ck_settlement_feathers_nonnegative"),
        sa.CheckConstraint("stars_credited >= 0", name="ck_settlement_stars_nonnegative"),
        sa.ForeignKeyConstraint(["event_id"], ["completion_inbox.event_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_completion_settlements_event_id"),
        sa.UniqueConstraint("run_id", "life_index", name="uq_completion_settlement_run_life"),
    )
    op.create_index(
        "ix_completion_settlements_status_run_life",
        "completion_settlements",
        ["status", "run_id", "life_index"],
    )
    op.create_table(
        "run_reward_caps",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("feathers_credited", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("feathers_credited BETWEEN 0 AND 30", name="ck_run_reward_cap_feathers"),
        sa.PrimaryKeyConstraint("run_id"),
    )


def downgrade():
    op.drop_table("run_reward_caps")
    op.drop_index("ix_completion_settlements_status_run_life", table_name="completion_settlements")
    op.drop_table("completion_settlements")

"""Create idempotent verified completion inbox."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_completion_inbox"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "completion_inbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("life_index", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
        sa.UniqueConstraint("run_id", "life_index", name="uq_completion_run_life"),
    )
    op.create_index("ix_completion_inbox_run_id", "completion_inbox", ["run_id"])


def downgrade():
    op.drop_index("ix_completion_inbox_run_id", table_name="completion_inbox")
    op.drop_table("completion_inbox")

"""Create waiter_calls table.

Revision ID: 016
Revises: 015
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waiter_calls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("call_uid", sa.String(36), nullable=False),
        sa.Column("table_id", sa.Integer(), sa.ForeignKey("tables.id"), nullable=True),
        sa.Column("menu_slug", sa.String(100), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="waiter"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("message", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_waiter_calls_call_uid", "waiter_calls", ["call_uid"], unique=True)
    op.create_index("ix_waiter_calls_menu_slug", "waiter_calls", ["menu_slug"])


def downgrade() -> None:
    op.drop_index("ix_waiter_calls_menu_slug", table_name="waiter_calls")
    op.drop_index("ix_waiter_calls_call_uid", table_name="waiter_calls")
    op.drop_table("waiter_calls")

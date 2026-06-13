"""Create staff_members table.

Revision ID: 017
Revises: 016
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("restaurant_id", sa.String(100), nullable=False),
        sa.Column("menu_slug", sa.String(100), nullable=False),
        sa.Column("clerk_user_id", sa.String(100), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="waiter"),
        sa.Column("pin_code", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_staff_members_restaurant_id", "staff_members", ["restaurant_id"])
    op.create_index("ix_staff_members_menu_slug", "staff_members", ["menu_slug"])
    op.create_index("ix_staff_members_clerk_user_id", "staff_members", ["clerk_user_id"])


def downgrade() -> None:
    op.drop_index("ix_staff_members_clerk_user_id", table_name="staff_members")
    op.drop_index("ix_staff_members_menu_slug", table_name="staff_members")
    op.drop_index("ix_staff_members_restaurant_id", table_name="staff_members")
    op.drop_table("staff_members")

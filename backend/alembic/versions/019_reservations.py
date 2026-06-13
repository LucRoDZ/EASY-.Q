"""Create reservations table.

Revision ID: 019
Revises: 018
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reservations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("menu_slug", sa.String(100), nullable=False),
        sa.Column("table_id", sa.Integer(), sa.ForeignKey("tables.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(50), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("party_size", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("date", sa.String(10), nullable=False),
        sa.Column("time", sa.String(5), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_reservations_menu_slug", "reservations", ["menu_slug"])
    op.create_index("ix_reservations_date", "reservations", ["date"])


def downgrade() -> None:
    op.drop_index("ix_reservations_date", table_name="reservations")
    op.drop_index("ix_reservations_menu_slug", table_name="reservations")
    op.drop_table("reservations")

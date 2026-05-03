"""Create orders table for KDS and Scan & Go pickup numbers.

Revision ID: 011
Revises: 010
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("menu_slug", sa.String(length=100), nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=True),
        sa.Column("table_token", sa.String(length=36), nullable=True),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="eur"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("pickup_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.ForeignKeyConstraint(["table_id"], ["tables.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_orders_id"), "orders", ["id"], unique=False)
    op.create_index(op.f("ix_orders_menu_slug"), "orders", ["menu_slug"], unique=False)
    op.create_index(op.f("ix_orders_table_token"), "orders", ["table_token"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_orders_table_token"), table_name="orders")
    op.drop_index(op.f("ix_orders_menu_slug"), table_name="orders")
    op.drop_index(op.f("ix_orders_id"), table_name="orders")
    op.drop_table("orders")

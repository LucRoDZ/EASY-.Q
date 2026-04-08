"""Add restaurant_profiles and payments tables

Revision ID: 004
Revises: 003
Create Date: 2026-04-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create restaurant_profiles table
    op.create_table(
        "restaurant_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("opening_hours", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_restaurant_profiles_id"), "restaurant_profiles", ["id"], unique=False)
    op.create_index(op.f("ix_restaurant_profiles_slug"), "restaurant_profiles", ["slug"], unique=False)

    # Create payments table
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("menu_slug", sa.String(length=100), nullable=False),
        sa.Column("table_token", sa.String(length=36), nullable=True),
        sa.Column("payment_intent_id", sa.String(length=255), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("tip_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="eur"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("items", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_intent_id"),
    )
    op.create_index(op.f("ix_payments_id"), "payments", ["id"], unique=False)
    op.create_index(op.f("ix_payments_menu_slug"), "payments", ["menu_slug"], unique=False)
    op.create_index(op.f("ix_payments_payment_intent_id"), "payments", ["payment_intent_id"], unique=False)


def downgrade() -> None:
    # Drop payments table
    op.drop_index(op.f("ix_payments_payment_intent_id"), table_name="payments")
    op.drop_index(op.f("ix_payments_menu_slug"), table_name="payments")
    op.drop_index(op.f("ix_payments_id"), table_name="payments")
    op.drop_table("payments")

    # Drop restaurant_profiles table
    op.drop_index(op.f("ix_restaurant_profiles_slug"), table_name="restaurant_profiles")
    op.drop_index(op.f("ix_restaurant_profiles_id"), table_name="restaurant_profiles")
    op.drop_table("restaurant_profiles")

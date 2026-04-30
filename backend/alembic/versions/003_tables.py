"""Create tables table

Revision ID: 003
Revises: 002
Create Date: 2026-04-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tables",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("menu_slug", sa.String(length=100), nullable=False),
        sa.Column("restaurant_id", sa.String(length=100), nullable=False),
        sa.Column("number", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("qr_token", sa.String(length=36), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("qr_token"),
    )
    op.create_index(op.f("ix_tables_id"), "tables", ["id"], unique=False)
    op.create_index(op.f("ix_tables_menu_slug"), "tables", ["menu_slug"], unique=False)
    op.create_index(op.f("ix_tables_restaurant_id"), "tables", ["restaurant_id"], unique=False)
    op.create_index(op.f("ix_tables_qr_token"), "tables", ["qr_token"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tables_qr_token"), table_name="tables")
    op.drop_index(op.f("ix_tables_restaurant_id"), table_name="tables")
    op.drop_index(op.f("ix_tables_menu_slug"), table_name="tables")
    op.drop_index(op.f("ix_tables_id"), table_name="tables")
    op.drop_table("tables")

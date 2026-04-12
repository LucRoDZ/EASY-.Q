"""Add split tracking columns to payments

Revision ID: 007
Revises: 006
Create Date: 2026-04-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("split_count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "payments",
        sa.Column("split_index", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "payments",
        sa.Column("split_total", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payments", "split_total")
    op.drop_column("payments", "split_index")
    op.drop_column("payments", "split_count")

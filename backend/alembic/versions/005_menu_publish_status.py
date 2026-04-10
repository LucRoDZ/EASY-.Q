"""Add publish_status column to menus

Revision ID: 005
Revises: 004
Create Date: 2026-04-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "menus",
        sa.Column(
            "publish_status",
            sa.String(20),
            nullable=False,
            server_default="draft",
        ),
    )


def downgrade() -> None:
    op.drop_column("menus", "publish_status")

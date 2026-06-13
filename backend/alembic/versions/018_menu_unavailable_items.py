"""Add menus.unavailable_items (stock outage list managed from the KDS).

Revision ID: 018
Revises: 017
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("menus", sa.Column("unavailable_items", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("menus", "unavailable_items")

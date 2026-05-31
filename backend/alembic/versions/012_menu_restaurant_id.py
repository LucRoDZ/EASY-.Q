"""Add restaurant_id to menus for multi-tenancy.

Revision ID: 012
Revises: 011
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = [r[0] for r in conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='menus'"
    ))]
    if "restaurant_id" not in cols:
        op.add_column("menus", sa.Column("restaurant_id", sa.String(100), nullable=True))
    indexes = [r[0] for r in conn.execute(sa.text(
        "SELECT indexname FROM pg_indexes WHERE tablename='menus'"
    ))]
    if "ix_menus_restaurant_id" not in indexes:
        op.create_index("ix_menus_restaurant_id", "menus", ["restaurant_id"])


def downgrade() -> None:
    op.drop_index("ix_menus_restaurant_id", "menus")
    op.drop_column("menus", "restaurant_id")

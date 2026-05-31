"""Add status column to tables.

Revision ID: 013
Revises: 012
Create Date: 2026-05-31
"""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = [r[0] for r in conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='tables'"
    ))]
    if "status" not in cols:
        op.add_column("tables", sa.Column(
            "status", sa.String(20), nullable=False, server_default="available"
        ))


def downgrade() -> None:
    op.drop_column("tables", "status")

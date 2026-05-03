"""Add stripe_account_id to restaurant_profiles for Stripe Connect marketplace.

Revision ID: 010
Revises: 009
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "restaurant_profiles",
        sa.Column("stripe_account_id", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("restaurant_profiles", "stripe_account_id")

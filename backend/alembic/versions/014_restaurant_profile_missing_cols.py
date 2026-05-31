"""Add missing columns to restaurant_profiles: timezone, social_links.

Revision ID: 014
Revises: 013
Create Date: 2026-05-31
"""

from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE restaurant_profiles "
        "ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'Europe/Paris', "
        "ADD COLUMN IF NOT EXISTS social_links JSON"
    ))


def downgrade() -> None:
    op.drop_column("restaurant_profiles", "timezone")
    op.drop_column("restaurant_profiles", "social_links")

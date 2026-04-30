"""Add google_place_id to restaurant_profiles for Google Review CTA.

Revision ID: 009
Revises: 008
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "restaurant_profiles",
        sa.Column("google_place_id", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("restaurant_profiles", "google_place_id")

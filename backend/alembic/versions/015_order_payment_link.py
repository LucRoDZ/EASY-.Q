"""Link Order ↔ Payment: payments.order_id + orders.payment_id.

Revision ID: 015
Revises: 014
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"])
    op.add_column(
        "orders",
        sa.Column("payment_id", sa.Integer(), sa.ForeignKey("payments.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "payment_id")
    op.drop_index("ix_payments_order_id", table_name="payments")
    op.drop_column("payments", "order_id")

"""Add performance indexes for menu, payment, and order queries.

Revision ID: 008
Revises: 007
Create Date: 2026-04-19
"""

from alembic import op

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # menus: slug is the most-queried column (public menu, dashboard)
    op.create_index("ix_menus_slug", "menus", ["slug"], unique=True, if_not_exists=True)
    op.create_index("ix_menus_status", "menus", ["status"], if_not_exists=True)
    op.create_index("ix_menus_publish_status", "menus", ["publish_status"], if_not_exists=True)

    # payments: queried by payment_intent_id (Stripe webhook) and menu_slug
    op.create_index("ix_payments_payment_intent_id", "payments", ["payment_intent_id"], unique=True, if_not_exists=True)
    op.create_index("ix_payments_menu_slug", "payments", ["menu_slug"], if_not_exists=True)
    op.create_index("ix_payments_status", "payments", ["status"], if_not_exists=True)

    # orders: queried by menu_slug and status (KDS dashboard)
    op.create_index("ix_orders_menu_slug", "orders", ["menu_slug"], if_not_exists=True)
    op.create_index("ix_orders_status", "orders", ["status"], if_not_exists=True)
    op.create_index("ix_orders_table_id", "orders", ["table_id"], if_not_exists=True)

    # audit_logs: queried by actor_id, action, and resource_type
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"], if_not_exists=True)
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], if_not_exists=True)
    op.create_index("ix_audit_logs_resource_type", "audit_logs", ["resource_type"], if_not_exists=True)

    # conversations: queried by menu_id + session_id
    op.create_index(
        "ix_conversations_menu_session",
        "conversations",
        ["menu_id", "session_id"],
        if_not_exists=True,
    )

    # tables: queried by menu_slug and qr_token
    op.create_index("ix_tables_menu_slug", "tables", ["menu_slug"], if_not_exists=True)
    op.create_index("ix_tables_qr_token", "tables", ["qr_token"], unique=True, if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_menus_slug", "menus")
    op.drop_index("ix_menus_status", "menus")
    op.drop_index("ix_menus_publish_status", "menus")
    op.drop_index("ix_payments_payment_intent_id", "payments")
    op.drop_index("ix_payments_menu_slug", "payments")
    op.drop_index("ix_payments_status", "payments")
    op.drop_index("ix_orders_menu_slug", "orders")
    op.drop_index("ix_orders_status", "orders")
    op.drop_index("ix_orders_table_id", "orders")
    op.drop_index("ix_audit_logs_actor_id", "audit_logs")
    op.drop_index("ix_audit_logs_action", "audit_logs")
    op.drop_index("ix_audit_logs_resource_type", "audit_logs")
    op.drop_index("ix_conversations_menu_session", "conversations")
    op.drop_index("ix_tables_menu_slug", "tables")
    op.drop_index("ix_tables_qr_token", "tables")

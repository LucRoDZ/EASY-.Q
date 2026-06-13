from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON
from app.db import Base


class Menu(Base):
    __tablename__ = "menus"

    id = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(String(100), nullable=True, index=True)  # Clerk user ID — null for anonymous uploads
    restaurant_name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    pdf_path = Column(String(500), nullable=False)
    languages = Column(String(50), nullable=False, default="en,fr,es")
    menu_data = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="ready")  # "processing" | "ready" | "error"
    publish_status = Column(String(20), nullable=False, default="draft")  # "draft" | "published"
    ocr_error = Column(String(500), nullable=True)
    unavailable_items = Column(JSON, nullable=True, default=list)  # noms d'articles en rupture
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversations = relationship(
        "Conversation", back_populates="menu", cascade="all, delete-orphan"
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    menu_id = Column(Integer, ForeignKey("menus.id"), nullable=False)
    session_id = Column(String(100), nullable=False, index=True)  # Browser session ID
    messages = Column(Text, nullable=False, default="[]")  # JSON array of messages
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    menu = relationship("Menu", back_populates="conversations")


class Subscription(Base):
    """Plan abonnement restaurateur (Freemium / Pro)"""
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(String(100), nullable=False, index=True)
    plan = Column(String(20), nullable=False, default="free")  # "free" | "pro"
    stripe_subscription_id = Column(String(255), nullable=True, unique=True)
    status = Column(String(20), nullable=False, default="active")  # "active" | "past_due" | "canceled"
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ChatSession(Base):
    """Sessions chatbot client (TTL Redis + persistance DB)"""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(String(100), nullable=False, index=True)
    table_id = Column(String(100), nullable=True)
    session_token = Column(String(255), nullable=False, unique=True, index=True)
    messages = Column(JSON, nullable=False, default=list)  # [{role, content, timestamp}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)


class Table(Base):
    """Table physique d'un restaurant — chaque table a son propre QR token."""
    __tablename__ = "tables"

    id = Column(Integer, primary_key=True, index=True)
    menu_slug = Column(String(100), nullable=False, index=True)   # FK-like to Menu.slug
    restaurant_id = Column(String(100), nullable=False, index=True)  # Clerk org ID (future)
    number = Column(String(20), nullable=False)      # "1", "A3", "Terrasse-2"
    label = Column(String(100), nullable=True)        # zone: "Terrasse", "Salle", "Bar"
    capacity = Column(Integer, nullable=False, default=4)
    qr_token = Column(String(36), nullable=False, unique=True, index=True)  # UUID v4
    is_active = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default="available")  # available, occupied, reserved
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RestaurantProfile(Base):
    """Profil d'un restaurant (logo, horaires, adresse)."""
    __tablename__ = "restaurant_profiles"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(100), unique=True, nullable=False, index=True)  # linked to Menu.slug
    name = Column(String(255), nullable=False, default="")
    owner_email = Column(String(255), nullable=True)   # for email notifications
    logo_url = Column(String(500), nullable=True)
    address = Column(String(500), nullable=True)
    phone = Column(String(50), nullable=True)
    opening_hours = Column(JSON, nullable=True)  # {"lundi": {"open": "09:00", "close": "22:00", "closed": false}, ...}
    timezone = Column(String(100), nullable=True, default="Europe/Paris")
    social_links = Column(JSON, nullable=True)   # {"instagram": url, "facebook": url, "google_maps": url}
    google_place_id = Column(String(255), nullable=True)  # Google Maps Place ID for Google Review CTA
    stripe_account_id = Column(String(255), nullable=True)  # Stripe Connect account ID (acct_...)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Payment(Base):
    """Enregistrement d'un paiement Stripe (PaymentIntent)."""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    menu_slug = Column(String(100), nullable=False, index=True)
    table_token = Column(String(36), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    payment_intent_id = Column(String(255), nullable=False, unique=True, index=True)
    amount = Column(Integer, nullable=False)       # per-person amount in cents (incl. tip)
    tip_amount = Column(Integer, nullable=False, default=0)  # tip in cents
    currency = Column(String(10), nullable=False, default="eur")
    status = Column(String(20), nullable=False, default="pending")  # pending|succeeded|failed
    items = Column(JSON, nullable=True)            # cart snapshot [{name, price, quantity}]
    # Split bill (migration 007): N parts paid separately for one order
    split_count = Column(Integer, nullable=False, default=1)   # total number of parts
    split_index = Column(Integer, nullable=False, default=1)   # this part's index (1-based)
    split_total = Column(Integer, nullable=True)               # full order total in cents
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Order(Base):
    """Commande passée via le menu client."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    menu_slug = Column(String(100), nullable=False, index=True)
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=True)
    table_token = Column(String(36), nullable=True, index=True)
    items = Column(JSON, nullable=False, default=list)   # [{name, price, quantity}]
    total = Column(Integer, nullable=False, default=0)   # in cents
    currency = Column(String(10), nullable=False, default="eur")
    status = Column(String(20), nullable=False, default="pending")  # pending|confirmed|in_progress|ready|done|cancelled
    notes = Column(Text, nullable=True)
    pickup_number = Column(Integer, nullable=True)  # Scan & Go: daily incremental counter
    # use_alter breaks the orders↔payments FK cycle for create/drop ordering
    payment_id = Column(Integer, ForeignKey("payments.id", use_alter=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WaiterCall(Base):
    """Appel serveur déclenché par un client (persisté en plus de Redis)."""
    __tablename__ = "waiter_calls"

    id = Column(Integer, primary_key=True, index=True)
    call_uid = Column(String(36), unique=True, nullable=False, index=True)  # matches Redis call id
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=True)
    menu_slug = Column(String(100), nullable=False, index=True)
    type = Column(String(20), nullable=False, default="waiter")  # waiter | bill | custom
    status = Column(String(20), nullable=False, default="pending")  # pending | acknowledged | resolved
    message = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class StaffMember(Base):
    """Membre du personnel d'un restaurant (serveur, cuisine, manager)."""
    __tablename__ = "staff_members"

    id = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(String(100), nullable=False, index=True)  # Clerk user ID of the owner
    menu_slug = Column(String(100), nullable=False, index=True)
    clerk_user_id = Column(String(100), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    role = Column(String(20), nullable=False, default="waiter")  # waiter | kitchen | manager
    pin_code = Column(String(255), nullable=True)  # bcrypt hashed 4-digit PIN
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Reservation(Base):
    """Réservation de table (formulaire public)."""
    __tablename__ = "reservations"

    id = Column(Integer, primary_key=True, index=True)
    menu_slug = Column(String(100), nullable=False, index=True)
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=True)
    name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=False)
    email = Column(String(255), nullable=True)
    party_size = Column(Integer, nullable=False, default=2)
    date = Column(String(10), nullable=False, index=True)   # YYYY-MM-DD
    time = Column(String(5), nullable=False)                # HH:MM
    status = Column(String(20), nullable=False, default="pending")  # pending|confirmed|cancelled|no_show|seated
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    """Log immuable pour RGPD + debug"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_type = Column(String(50), nullable=False)  # "user" | "system" | "admin"
    actor_id = Column(String(100), nullable=True)
    action = Column(String(100), nullable=False)  # e.g. "menu.create", "payment.success"
    resource_type = Column(String(50), nullable=True)  # e.g. "menu", "order", "payment"
    resource_id = Column(String(100), nullable=True)
    payload = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    created_at = Column(DateTime(timezone=True), server_default=func.now())

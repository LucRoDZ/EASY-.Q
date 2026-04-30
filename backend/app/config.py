import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./serveur_ai.db")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
STORAGE_DIR = os.getenv("STORAGE_DIR", "./storage")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Cloudflare R2 (S3-compatible)
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "easyq")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL", "")  # https://<account_id>.r2.cloudflarestorage.com
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "")       # optional custom domain for public objects

# Resend (transactional email)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "noreply@easy-q.app")

# Stripe
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRO_PRICE_ID = os.getenv("STRIPE_PRO_PRICE_ID", "")  # Stripe Price ID for Pro plan (49€/month)
STRIPE_BILLING_WEBHOOK_SECRET = os.getenv("STRIPE_BILLING_WEBHOOK_SECRET", "")

# CORS and Frontend
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# KDS (Kitchen Display System) — simple token auth, not Clerk
KDS_SECRET_TOKEN = os.getenv("KDS_SECRET_TOKEN", "kds-dev-token-change-in-production")

# Clerk auth
CLERK_WEBHOOK_SECRET = os.getenv("CLERK_WEBHOOK_SECRET", "")  # whsec_... from Clerk dashboard
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "")  # https://<clerk-domain>/.well-known/jwks.json
# Comma-separated Clerk user IDs that may access /api/v1/admin/* endpoints
ADMIN_USER_IDS: list[str] = [
    uid.strip()
    for uid in os.getenv("ADMIN_USER_IDS", "").split(",")
    if uid.strip()
]

# Sentry error tracking
SENTRY_DSN = os.getenv("SENTRY_DSN", "")  # Leave empty to disable Sentry

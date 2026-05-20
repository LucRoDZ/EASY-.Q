# Ralph Checkpoint — 2026-05-20

## Active Sprint — Auth Flow & Landing Page
**Read `.ralph/GOALS.md` and execute the first unchecked goal.**
Goals must be done in order: G1 → G2 → G3 → G4 → G5 → G6.

---

# Ralph Checkpoint — 2026-04-30

## Done
- Auth Clerk JWKS (python-jose), require_admin, ADMIN_USER_IDS in config
- PostgreSQL async models (User/Restaurant/Menu/Table/Order/Payment/Subscription/AuditLog), Alembic migrations 001–009
- Redis caching (menu 5 min, OCR 24h, chat sessions 2h, KDS pub/sub)
- R2/S3 storage (upload/download/presigned URLs)
- Upload PDF OCR (background task, SHA256 cache, retry ×3, status polling)
- Menu editor (CRUD sections/items, allergens, tags, publish/draft, auto-save, duplicate)
- Tables + QR codes (bulk create, export PDF, custom colors/logo)
- Restaurant settings page (profile, logo upload, opening hours, google_place_id)
- Dashboard restaurateur (menus list, QR count, quick actions)
- Onboarding multi-step + confetti + AuditLog
- Menu PWA client (`/:slug?table=TOKEN&lang=`) with AllergenIcons, CartSummaryBar, search/filter
- ChatWidget SSE streaming (Gemini, history, suggestions, dish-button add-to-cart)
- Waiter call (post + dismiss + history, Redis)
- CartContext (localStorage + BroadcastChannel)
- Checkout Stripe (PaymentElement, tip from URL param, webhook sig-verified)
- TipPage (presets 0/5/10/15% + free input, sends cents to CheckoutPage)
- ThankYouPage (NPS survey, Google review button, receipt download)
- Receipt PDF (WeasyPrint/reportlab, emailed via Resend)
- KDS WebSocket (manager, Redis pub/sub bridge, Kanban + timer + reconnect)
- Chatbot function calling `place_order` → creates Order in DB → broadcasts to KDS
- Analytics: revenue/covers/items/chatbot/heatmap + CSV export (UTF-8 BOM)
- Stripe Billing (checkout/portal/webhook, Pro plan, UpgradePage, SubscriptionPage)
- Admin backoffice (stats/restaurants/subscriptions/audit-logs endpoints, CI)
- Email service (welcome, receipt, NPS digest, bad review triggers via Resend)
- CI pipeline: GitHub Actions (ruff lint + pytest ≥70% + vitest + vite build)
- 404 backend tests passing; 111 frontend tests passing (as of Loop #2)

## Done (added this session)

- [✅] **api.post missing** — added `async post(url, body)` to `api.js` after `patch`
- [✅] **Admin auth mismatch** — `getAdmin*` methods now send `Authorization: Bearer <token>`; legacy `X-Admin-Token` methods removed; `AdminDashboardPage` has token gate with localStorage persistence
- [✅] **Admin status field mismatch** — replaced `r.status` → `r.publish_status` in `AdminDashboardPage.jsx` (badge, toggle handler, button label)
- [✅] **`Base.metadata.create_all`** — removed from `main.py`
- [✅] **`asyncio.run()` in public.py** — converted `_redis_get_session`, `_redis_save_session`, `get_public_menu`, `chat_with_menu`, `chat_with_menu_stream` to proper `async def` with `await`
- [✅] **Stripe Connect `stripe_account_id` in PATCH** — `restaurants.py` update_profile now persists `stripe_account_id`; `import requests` moved to module top; 2 new backend tests added
- [✅] **Scan & Go frontend tests** — 2 new `CheckoutPage.test.jsx` tests for `order_id` in PaymentIntent response
- [✅] **KDS path decision documented** — slug-based KDS path confirmed as correct design (Order model indexed by menu_slug)
- **Test counts: 416 backend / 113 frontend (all passing)**

## Remaining — Partial (business logic exists but broken or incomplete)
- [✅] **Pro gating** — `require_pro` now raises 402 when subscription absent or non-Pro/active
- [✅] **CartContext scoped by slug** — `setSlug(slug)` added; `MenuPage`/`CartPage` call it on mount; storage key is `easyq_cart_{slug}`
- [✅] **Health endpoint 503** — `health.py` returns HTTP 503 when DB or Redis is down
- [✅] **Admin KPI fix** — `admin.py` filters `Menu.publish_status == "published"` for active_restaurants count
- [✅] **ChatWidget / CartPage duplicates** — both already removed (files don't exist)
- [✅] **KDS path uses slug not restaurant_id** — deliberate decision: `Order.menu_slug` is the indexed join key; using `restaurant_id` UUID would require extra joins with no benefit. Both frontend (`KitchenScreen.jsx:151`) and backend (`kds.py:78`) use slug consistently. Off-spec but correct design.

## Remaining — Not Started

- [✅] **Apple Pay / Google Pay** — `PaymentRequestButtonElement` added to `CheckoutPage.jsx`; `canMakePayment()` guard; `confirmCardPayment` handler; test mock updated.
- [✅] **Stripe Connect marketplace** — `stripe_account_id` on `RestaurantProfile` model + migration 010; `STRIPE_PLATFORM_FEE_PERCENT` in config; `transfer_data`/`application_fee_amount` in `payments.py`; schemas updated.
- [❌] **E2E tests (Playwright)** — zero E2E coverage; roadmap Phase 12.3.
- [❌] **POS integration (Zelty/Lightspeed)** — roadmap Phase 6.2.
- [❌] **Loyalty program** — roadmap Phase 6.3.
- [❌] **CRM restaurateur** — roadmap Phase 6.4.
- [❌] **Multi-establishment** — roadmap Phase 6.6.
- [✅] **Google Places widget** — `GET /api/v1/restaurants/{slug}/google-rating` (1h in-proc cache); star rating shown in MenuPage header when place_id configured.
- [✅] **Scan & Go mode** — `pickup_number` assigned at PaymentIntent creation (no table_token); `order_id` in return URL; ThankYouPage shows pickup badge; migration 011 for `orders` table.
